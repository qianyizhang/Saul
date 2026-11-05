import { expect, it, vi } from 'vitest';
import {
  generateSpeech,
  speechBlob,
  speechCredential,
  validateSpeechRequest,
  type SpeechRequest,
} from '../src/speech/realtime';
import { DEFAULT_SETTINGS } from '../src/storage/settings';
import { validatePlanRequest } from '../native/plan-protocol.mts';

const request: SpeechRequest = {
  presetId: 'speak',
  connectionKey: 'openai-api',
  model: 'gpt-realtime-2.1-mini',
  voice: 'marin',
  input: 'Hello.',
};
function connection() {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.connectionProfiles = { 'openai-api': 'official' };
  settings.profiles = [
    {
      id: 'official',
      name: 'API',
      config: { ...settings.openaiCompatible, apiKey: 'private-fixture' },
    },
  ];
  settings.configuration!.presets.push({
    id: request.presetId,
    name: 'Speak',
    connectionKey: request.connectionKey,
    provider: 'openai-compatible',
    model: request.model,
    capability: 'speak',
    speechOptions: { voice: request.voice },
  });
  return settings;
}
class Socket extends EventTarget {
  sent: unknown[] = [];
  closed = false;
  send(value: string) {
    this.sent.push(JSON.parse(value));
  }
  close() {
    this.closed = true;
  }
  emit(value: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }));
  }
}
async function speech(
  fetcher = vi.fn<typeof fetch>(async () => Response.json({ value: 'ek_fixture' })),
) {
  const socket = new Socket();
  const open = vi.fn(() => socket as unknown as WebSocket);
  const controller = new AbortController();
  const result = generateSpeech(request, 'private-fixture', controller.signal, {
    fetcher,
    socket: open,
  });
  await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
  return { socket, controller, result, fetcher, open };
}
it('bounds speech and removes the OAuth speech operation', () => {
  expect(() => validateSpeechRequest(request)).not.toThrow();
  for (const patch of [
    { input: '' },
    { input: ' ' },
    { input: 'a'.repeat(513) },
    { voice: 'nova' },
    { model: 'gpt-4o-mini-tts' },
    { endpoint: 'https://example.com' },
  ])
    expect(() => validateSpeechRequest({ ...request, ...patch })).toThrow();
  expect(() =>
    validatePlanRequest({
      action: 'speech',
      accountId: 'fixture',
      input: 'Hello.',
      voice: 'marin',
    }),
  ).toThrow('Unsupported plan operation');
});
it('uses exactly the selected saved API connection and rejects stale or non-Speak presets', () => {
  const settings = connection();
  expect(speechCredential(settings, request)).toBe('private-fixture');
  for (const patch of [
    { model: 'gpt-realtime-2.1' },
    { voice: 'cedar' },
    { connectionKey: 'another' },
  ])
    expect(() => speechCredential(settings, { ...request, ...patch })).toThrow('changed');
  settings.connectionProfiles!['openai-api'] = 'missing';
  expect(() => speechCredential(settings, request)).toThrow('connection');
  settings.connectionProfiles!['openai-api'] = 'official';
  settings.profiles![0]!.config.baseUrl = 'https://example.com/v1';
  expect(() => speechCredential(settings, request)).toThrow('https://api.openai.com/v1');
  settings.profiles![0]!.config.baseUrl = 'https://api.openai.com/v1';
  settings.profiles![0]!.config.apiKey = '';
  expect(() => speechCredential(settings, request)).toThrow('API key');
});
it('authenticates once with an ephemeral secret and converts completed PCM to playable WAV', async () => {
  const s = await speech();
  const [url, options] = s.fetcher.mock.calls[0]!;
  expect(url).toBe('https://api.openai.com/v1/realtime/client_secrets');
  expect(options!.redirect).toBe('error');
  expect(new Headers(options!.headers).get('Authorization')).toBe('Bearer private-fixture');
  expect(JSON.parse(String(options!.body))).toMatchObject({
    session: {
      type: 'realtime',
      model: request.model,
      output_modalities: ['audio'],
      audio: {
        input: { turn_detection: null },
        output: { voice: 'marin', format: { type: 'audio/pcm', rate: 24000 } },
      },
    },
  });
  expect(s.open).toHaveBeenCalledWith(
    'wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1-mini',
    ['realtime', 'openai-insecure-api-key.ek_fixture'],
  );
  s.socket.emit({ type: 'session.created' });
  expect(s.socket.sent).toEqual([
    expect.objectContaining({
      type: 'response.create',
      response: expect.objectContaining({
        output_modalities: ['audio'],
        input: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hello.' }] },
        ],
      }),
    }),
  ]);
  s.socket.emit({ type: 'response.output_audio.delta', delta: 'AQACAA==' });
  s.socket.emit({ type: 'response.done', response: { status: 'completed' } });
  const result = await s.result;
  const bytes = new Uint8Array(await speechBlob(result).arrayBuffer());
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF');
  expect(new DataView(bytes.buffer).getUint32(24, true)).toBe(24000);
  expect([...bytes.slice(44)]).toEqual([1, 0, 2, 0]);
  expect(s.socket.closed).toBe(true);
  expect(s.fetcher).toHaveBeenCalledTimes(1);
});
it('preserves authorization errors without echoing bodies or falling back', async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ error: { message: 'private-fixture' } }, { status: 401 }),
  );
  await expect(
    generateSpeech(request, 'private-fixture', new AbortController().signal, { fetcher }),
  ).rejects.toThrow('HTTP 401');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('rejects failed, empty, malformed and disconnected output', async () => {
  for (const terminal of [
    { type: 'error', error: { message: 'private-fixture' } },
    { type: 'response.done', response: { status: 'failed' } },
    { type: 'response.done', response: { status: 'completed' } },
    { type: 'response.output_audio.delta', delta: '???' },
    'disconnect',
  ]) {
    const s = await speech();
    const rejected = expect(s.result).rejects.toThrow();
    s.socket.emit({ type: 'session.created' });
    if (terminal === 'disconnect') s.socket.dispatchEvent(new Event('close'));
    else s.socket.emit(terminal);
    await rejected;
    expect(s.socket.closed).toBe(true);
  }
});
it('cancels the active socket and ignores later audio', async () => {
  const s = await speech();
  const rejected = expect(s.result).rejects.toThrow('stopped');
  s.controller.abort();
  await rejected;
  expect(s.socket.closed).toBe(true);
  s.socket.emit({ type: 'session.created' });
  expect(s.socket.sent).toHaveLength(0);
});

it('never exposes malformed provider payloads in parse errors', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response('private-fixture'));
  await expect(
    generateSpeech(request, 'private-fixture', new AbortController().signal, { fetcher }),
  ).rejects.toThrow('invalid Realtime client secret');
  const s = await speech();
  const rejected = expect(s.result).rejects.toThrow('Realtime returned an invalid event.');
  s.socket.dispatchEvent(new MessageEvent('message', { data: 'private-fixture' }));
  await rejected;
});

it('rejects oversized audio and an incomplete PCM sample without returning a player result', async () => {
  const large = await speech();
  const oversized = expect(large.result).rejects.toThrow('preview limit');
  large.socket.emit({ type: 'session.created' });
  const delta = btoa('\0'.repeat(600_000));
  for (let i = 0; i < 11; i++) large.socket.emit({ type: 'response.output_audio.delta', delta });
  await oversized;
  expect(large.socket.closed).toBe(true);
  const odd = await speech();
  const incomplete = expect(odd.result).rejects.toThrow('incomplete audio');
  odd.socket.emit({ type: 'session.created' });
  odd.socket.emit({ type: 'response.output_audio.delta', delta: 'AA==' });
  odd.socket.emit({ type: 'response.done', response: { status: 'completed' } });
  await incomplete;
});
