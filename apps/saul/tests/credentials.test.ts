import { afterEach, expect, it, vi } from 'vitest';
import { initCredentialBridge } from '../src/native/credentials';
import {
  validateCredentialEvent,
  validateCredentialRequest,
} from '../native/credentials-contract.mts';
import { sharedCredentialProjection, stripOfficialKeys } from '../src/storage/credentials';
import { DEFAULT_SETTINGS, validateProviderSettings } from '../src/storage/settings';
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
it('projects only official keys into the native owner and preserves custom provider credentials', () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.openaiCompatible.apiKey = 'official-fixture';
  settings.profiles = [
    {
      id: 'custom',
      name: 'Custom',
      config: {
        ...settings.openaiCompatible,
        baseUrl: 'https://custom.test/v1',
        apiKey: 'custom-fixture',
      },
    },
  ];
  const projected = sharedCredentialProjection(settings);
  expect(projected.openaiCompatible).toMatchObject({ apiKey: '', credentialOwner: 'saul' });
  expect(projected.profiles![0]!.config.apiKey).toBe('custom-fixture');
  expect(settings.openaiCompatible.apiKey).toBe('official-fixture');
  const backup = stripOfficialKeys(settings) as typeof settings;
  expect(backup.openaiCompatible.apiKey).toBe('');
  expect(backup.profiles![0]!.config.apiKey).toBe('custom-fixture');
  expect(() =>
    validateProviderSettings({ ...projected, sharedCredentials: 'disconnected' }),
  ).toThrow(/Connect/);
});
