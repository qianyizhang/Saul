import { afterEach, expect, it, vi } from 'vitest';
import { initCredentialBridge } from '../src/native/credentials';
import {
  validateCredentialEvent,
  validateCredentialRequest,
} from '../native/credentials-contract.mts';
import { nativeCredentialAccess } from '../src/configuration/credentials';
import { DEFAULT_CONFIGURATION } from '../src/configuration/definition';
import { validImageOptions } from '../native/shared-presets-contract.mts';

const imageRequest = {
  action: 'api-image',
  model: 'gpt-image-2.6-flare',
  prompt: 'A fixture image',
  size: '1024x1024',
  quality: 'low',
  outputFormat: 'png',
};

it('accepts supported scalar image options and speech voices at the credential boundary', () => {
  for (const size of ['1024x1024', '1536x1024', '1024x1536'])
    for (const quality of ['low', 'medium', 'high'])
      for (const outputFormat of ['png', 'gif'])
        expect(() =>
          validateCredentialRequest({ ...imageRequest, size, quality, outputFormat }),
        ).not.toThrow();
  for (const voice of [
    'alloy',
    'ash',
    'ballad',
    'coral',
    'echo',
    'sage',
    'shimmer',
    'verse',
    'marin',
    'cedar',
  ])
    expect(() =>
      validateCredentialRequest({ action: 'api-realtime', model: 'gpt-realtime', voice }),
    ).not.toThrow();
});

it('rejects arrays and other nonscalar options before forwarding a credential request', () => {
  for (const [field, scalar] of [
    ['size', '1024x1024'],
    ['quality', 'low'],
    ['outputFormat', 'gif'],
    ['voice', 'marin'],
  ] as const) {
    const request =
      field === 'voice' ? { action: 'api-realtime', model: 'gpt-realtime' } : imageRequest;
    for (const value of [
      [scalar],
      [[scalar]],
      [],
      null,
      undefined,
      true,
      1,
      {},
      { value: scalar },
      'unsupported',
    ])
      expect(() => validateCredentialRequest({ ...request, [field]: value })).toThrow();
  }
  const h = harness();
  const client = h.connect('chrome-extension://extension/popup.html');
  client.receive({ action: 'api-realtime', model: 'gpt-realtime', voice: ['marin'] });
  expect(h.connectNative).not.toHaveBeenCalled();
});

it('keeps stored-option and credential-request policies separate', () => {
  expect(validImageOptions({ size: '1024x1024', quality: 'low' })).toBe(true);
  const missingFormat: Partial<typeof imageRequest> = { ...imageRequest };
  delete missingFormat.outputFormat;
  expect(() => validateCredentialRequest(missingFormat)).toThrow();
  expect(() =>
    validateCredentialRequest({ ...imageRequest, model: 'gpt-image-2.5-flare' }),
  ).not.toThrow();
  expect(() =>
    validateCredentialRequest({
      ...imageRequest,
      model: 'gpt-image-2.5-flare',
      outputFormat: 'gif',
    }),
  ).toThrow('GIF requires');
  expect(() =>
    validateCredentialRequest({
      ...imageRequest,
      model: 'gpt-image-2.5-flare',
      outputFormat: ['gif'],
    }),
  ).toThrow();
  for (const patch of [
    { model: '' },
    { model: ['gpt-image-2.6-flare'] },
    { prompt: '' },
    { prompt: ['fixture'] },
    { extra: true },
  ])
    expect(() => validateCredentialRequest({ ...imageRequest, ...patch })).toThrow();
});
function harness() {
  let accept: (port: chrome.runtime.Port) => void = () => {};
  const nativeListeners: ((value: unknown) => void)[] = [];
  const native = {
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: { addListener: (fn: (v: unknown) => void) => nativeListeners.push(fn) },
    onDisconnect: { addListener: vi.fn() },
  };
  const connectNative = vi.fn(() => native);
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'extension',
      getURL: (path: string) => `chrome-extension://extension/${path}`,
      onMessage: { addListener: vi.fn() },
      onConnect: {
        addListener: (fn: typeof accept) => {
          accept = fn;
        },
      },
      connectNative,
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
    tabs: { create: vi.fn().mockResolvedValue({}) },
  });
  initCredentialBridge();
  function connect(url: string, tab = false) {
    let receive = (_value: unknown) => {},
      disconnect = () => {};
    const port = {
      name: 'saul-credentials',
      sender: { id: 'extension', url, ...(tab ? { tab: { id: 1 } } : {}) },
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      onMessage: {
        addListener: (fn: typeof receive) => {
          receive = fn;
        },
      },
      onDisconnect: {
        addListener: (fn: typeof disconnect) => {
          disconnect = fn;
        },
      },
    };
    accept(port as unknown as chrome.runtime.Port);
    return { port, receive, disconnect };
  }
  return {
    native,
    connectNative,
    connect,
    emit: (value: unknown) => nativeListeners.forEach((fn) => fn(value)),
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('denies page callers and credential operations from the offscreen runner', () => {
  const h = harness();
  expect(h.connect('https://example.test', true).port.disconnect).toHaveBeenCalled();
  h.connect('chrome-extension://extension/offscreen.html').receive({
    action: 'api-key-save',
    key: 'fixture',
  });
  expect(h.connectNative).not.toHaveBeenCalled();
});
it('rejects arbitrary endpoints and token-shaped results', () => {
  expect(() =>
    validateCredentialRequest({
      action: 'api-chat',
      model: 'm',
      systemPrompt: '',
      userPrompt: 'u',
      url: 'https://evil.test',
    }),
  ).toThrow();
  expect(() =>
    validateCredentialEvent({
      type: 'result',
      accounts: [
        { id: 'id', label: 'label', signedIn: true, planEnabled: true, refreshToken: 'secret' },
      ],
    }),
  ).toThrow();
  expect(() =>
    validateCredentialEvent({ type: 'delta', text: 'hello', accessToken: 'secret' }),
  ).toThrow();
  expect(() => validateCredentialEvent({ type: 'result', apiConnected: 'yes' })).toThrow();
});
it('does not replay or fall back when a native connection fails', () => {
  const h = harness();
  const ui = h.connect('chrome-extension://extension/library.html');
  ui.receive({ action: 'status' });
  const id = h.native.postMessage.mock.calls[0]![0].id;
  h.emit({ id, event: { type: 'error', message: 'Synthetic denial' } });
  expect(ui.port.postMessage).toHaveBeenCalledWith({ type: 'error', message: 'Synthetic denial' });
  expect(h.connectNative).toHaveBeenCalledTimes(1);
  expect(h.native.disconnect).toHaveBeenCalled();
});
it('keeps login alive after popup closure and opens only the official authorize endpoint', () => {
  const h = harness();
  const ui = h.connect('chrome-extension://extension/library.html');
  ui.receive({ action: 'login' });
  const id = h.native.postMessage.mock.calls[0]![0].id;
  ui.disconnect();
  expect(h.native.disconnect).not.toHaveBeenCalled();
  h.emit({ id, event: { type: 'authorize', url: 'https://evil.test/authorize' } });
  expect(chrome.tabs.create).not.toHaveBeenCalled();
  expect(h.native.disconnect).toHaveBeenCalled();
});
it('cancels an ordinary operation on caller loss', () => {
  const h = harness();
  const ui = h.connect('chrome-extension://extension/library.html');
  ui.receive({ action: 'api-key-status' });
  ui.disconnect();
  expect(h.native.disconnect).toHaveBeenCalled();
  expect(h.connectNative).toHaveBeenCalledTimes(1);
});
it('connects only through the newer signed owner, without importing a key or rebinding an account', async () => {
  const h = harness();
  const legacy = structuredClone(DEFAULT_CONFIGURATION);
  legacy.openaiCompatible.apiKey = 'local-fixture-key';
  legacy.chatgptPlan = { accountId: 'legacy-account', model: 'old' };
  const optedIn = { ...legacy, sharedCredentials: 'saul' as const };
  let prepare = nativeCredentialAccess.prepare(optedIn, legacy);
  let sent = h.native.postMessage.mock.lastCall![0];
  expect(sent).toMatchObject({ version: 2, request: { action: 'status' } });
  h.emit({
    id: sent.id,
    event: { type: 'error', message: 'Unsupported or invalid Saul credential operation.' },
  });
  await expect(prepare).rejects.toThrow();
  prepare = nativeCredentialAccess.prepare(optedIn, legacy);
  sent = h.native.postMessage.mock.lastCall![0];
  h.emit({
    id: sent.id,
    event: {
      type: 'result',
      apiConnected: false,
      accounts: [{ id: 'shared-account', label: 'Fixture', signedIn: true, planEnabled: true }],
      selectedAccountId: 'shared-account',
    },
  });
  await expect(prepare).resolves.toEqual(optedIn);
  const disconnected = { ...optedIn, sharedCredentials: 'disconnected' as const };
  await expect(nativeCredentialAccess.prepare(disconnected, optedIn)).resolves.toEqual(
    disconnected,
  );
  expect(h.native.postMessage.mock.calls.map(([frame]) => frame.request)).toEqual([
    { action: 'status' },
    { action: 'status' },
  ]);
});
