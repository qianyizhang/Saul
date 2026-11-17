import { afterEach, expect, it, vi } from 'vitest';
import {
  CREDENTIALS_PORT,
  type CredentialRequest,
} from '../shared/protocol/credentials-contract.mts';
import { type ModelPreset } from '../shared/model/presets.ts';
import { DEFAULT_CONFIGURATION } from '../src/configuration/definition';
import { prepareFrozenPreset, preparePreset } from '../src/configuration/resolve';
import type { ModelRequest } from '../shared/model/execution-route.ts';
import { streamModel } from '../src/providers/stream';

const preset: ModelPreset = {
  id: 'chosen',
  name: 'Chosen',
  provider: 'openai-compatible',
  profileId: 'original',
  model: 'frozen-model',
};
function settings() {
  const settings = structuredClone(DEFAULT_CONFIGURATION);
  settings.sharedCredentials = 'saul';
  settings.profiles = [
    {
      id: 'original',
      name: 'Original',
      config: {
        baseUrl: 'https://api.openai.com/v1',
        model: 'different-current-model',
        temperature: 0.3,
        apiKey: 'fixture-private-key',
      },
    },
  ];
  return settings;
}
function transport(model = preset.model) {
  const requests: CredentialRequest[] = [];
  const connect = vi.fn(({ name }: { name: string }) => {
    expect(name).toBe(CREDENTIALS_PORT);
    let listener: (value: unknown) => void;
    return {
      onMessage: {
        addListener: (fn: (value: unknown) => void) => {
          listener = fn;
        },
      },
      onDisconnect: { addListener: vi.fn() },
      disconnect: vi.fn(),
      postMessage(request: CredentialRequest) {
        requests.push(request);
        if (request.action === 'connection-catalog') {
          listener({
            type: 'result',
            catalog: {
              fetchedAt: 1,
              models: [
                { id: model, name: model, capabilities: ['write'], efforts: [], defaultEffort: '' },
              ],
            },
          });
        } else {
          listener({ type: 'delta', text: 'fixture answer' });
          listener({ type: 'complete' });
        }
      },
    };
  });
  vi.stubGlobal('chrome', {
    runtime: {
      connect,
      sendMessage: vi.fn().mockResolvedValue({ success: true, result: { mode: 'saul' } }),
    },
  });
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  return { requests, connect, fetch };
}
async function generate(input: ModelRequest, credential: string) {
  const events = [];
  for await (const event of streamModel(input, credential)) events.push(event);
  expect(events.at(-1)).toEqual({ type: 'complete' });
}
const prompts = { systemPrompt: 'Frozen instruction', userPrompt: 'Frozen input' };
afterEach(() => vi.unstubAllGlobals());

it('retries the bound plan and sends its frozen account, model and options through the signed owner', async () => {
  const { requests, fetch } = transport();
  const value = settings();
  value.chatgptPlan = { accountId: 'other', model: 'other' };
  value.connections = [{ key: 'work', name: 'Work', kind: 'chatgpt-plan', accountId: 'bound' }];
  const chosen = {
    ...preset,
    provider: 'chatgpt-plan' as const,
    connectionKey: 'work',
    effort: 'medium',
    fast: true,
  };
  const prepared = preparePreset(value, chosen);
  chosen.model = 'changed later';
  const original = { ...prepared.choices, ...prompts };
  const retry = prepareFrozenPreset(value, original);
  await generate(retry.input, retry.credential);
  expect(requests).toEqual([
    {
      action: 'generate',
      connectionKey: 'work',
      accountId: 'bound',
      model: preset.model,
      effort: 'medium',
      fast: true,
      ...prompts,
    },
  ]);
  expect(fetch).not.toHaveBeenCalled();
  const conflicting = structuredClone(original);
  conflicting.preset!.fast = false;
  expect(() => prepareFrozenPreset(value, conflicting)).toThrow('preset Fast choice');
  await expect(streamModel(conflicting, '').next()).rejects.toThrow('preset Fast choice');
  expect(requests).toHaveLength(1);
});

it('uses the frozen managed API connection for discovery and generation, and blocks an endpoint change', async () => {
  const { requests, fetch } = transport();
  const value = settings();
  const connection = {
    key: 'work',
    name: 'Work',
    kind: 'openai-api' as const,
    baseUrl: 'https://models.example.test/v1',
  };
  value.connections = [connection];
  const { choices, credential } = preparePreset(value, { ...preset, connectionKey: 'work' });
  expect(credential).toBe('');
  expect(JSON.stringify(choices)).not.toContain('fixture-private-key');
  const original = { ...choices, ...prompts };
  await generate(original, credential);
  expect(requests).toMatchObject([
    { action: 'connection-catalog', connectionKey: 'work' },
    { action: 'api-chat', connectionKey: 'work', model: preset.model, ...prompts },
  ]);
  connection.baseUrl = 'https://different.example.test/v1';
  expect(() => prepareFrozenPreset(value, original)).toThrow('saved connection');
  expect(fetch).not.toHaveBeenCalled();
});

it('sends a historical top-level-only signed OpenAI request without a new connection or catalog lookup', async () => {
  const { requests, fetch } = transport();
  const value = settings();
  value.profiles![0]!.config.credentialOwner = 'saul';
  const { choices } = preparePreset(value, preset);
  const original: ModelRequest = { ...choices, credentialOwner: 'saul', ...prompts };
  delete original.remote.credentialOwner;
  const retry = prepareFrozenPreset(value, original);
  await generate(retry.input, retry.credential);
  expect(requests).toMatchObject([{ action: 'api-chat', model: preset.model, ...prompts }]);
  expect(requests[0]).not.toHaveProperty('connectionKey');
  expect(fetch).not.toHaveBeenCalled();
  await expect(
    streamModel(
      { ...original, remote: { ...original.remote, baseUrl: 'https://wrong.test/v1' } },
      '',
    ).next(),
  ).rejects.toThrow('saved connection');
  expect(requests).toHaveLength(1);
});

it('keeps a browser-owned retry on the same frozen endpoint, model and profile', async () => {
  const { connect, fetch } = transport();
  const value = settings();
  const { choices } = preparePreset(value, preset);
  const profile = value.profiles![0]!;
  profile.config.apiKey = 'rotated-fixture-key';
  profile.config.model = 'changed default';
  fetch.mockResolvedValue(
    new Response('data: {"choices":[{"delta":{"content":"answer"}}]}\n\ndata: [DONE]\n\n'),
  );
  const retry = prepareFrozenPreset(value, { ...choices, ...prompts });
  await generate(retry.input, retry.credential);
  expect(fetch).toHaveBeenCalledOnce();
  const [url, options] = fetch.mock.calls[0]!;
  expect(url).toBe('https://api.openai.com/v1/chat/completions');
  expect(options.headers).toMatchObject({ Authorization: 'Bearer rotated-fixture-key' });
  expect(JSON.parse(options.body)).toMatchObject({ model: preset.model });
  expect(connect).not.toHaveBeenCalled();
});

it('does not execute a contradictory saved owner under either billing route', async () => {
  const { connect, fetch } = transport();
  const value = settings();
  const original: ModelRequest = {
    ...preparePreset(value, preset).choices,
    ...prompts,
    credentialOwner: 'local',
  };
  original.remote.credentialOwner = 'saul';
  expect(() => prepareFrozenPreset(value, original)).toThrow('conflicting credential owners');
  await expect(streamModel(original, 'fixture-local-secret').next()).rejects.toThrow(
    'conflicting credential owners',
  );
  expect(connect).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
