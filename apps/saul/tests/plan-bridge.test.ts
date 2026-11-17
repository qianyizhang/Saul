import { afterEach, expect, it, vi } from 'vitest';
import { initStorageBridge } from '../src/native/storage-bridge';
function harness() {
  let accept: (port: chrome.runtime.Port) => void = () => {};
  const nativeListeners: ((value: unknown) => void)[] = [];
  const native = {
    postMessage: vi.fn(),
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
    },
  });
  initStorageBridge();
  function connect(url: string, tab = false) {
    let receive = (_value: unknown) => {},
      disconnect = () => {};
    const port = {
      name: 'saul-chatgpt',
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
it('rejects page callers and lets the offscreen runner request only shared history', () => {
  vi.useFakeTimers();
  const h = harness();
  expect(h.connect('https://example.test', true).port.disconnect).toHaveBeenCalled();
  expect(
    h.connect('chrome-extension://extension/content.js', true).port.disconnect,
  ).toHaveBeenCalled();
  const runner = h.connect('chrome-extension://extension/offscreen.html');
  runner.receive({ action: 'config-read', section: 'settings' });
  expect(runner.port.postMessage).toHaveBeenCalledWith({
    type: 'error',
    message: 'Runner may only request history.',
  });
  expect(h.connectNative).not.toHaveBeenCalled();
});
it('never forwards retired credential operations, even if an old helper is installed', () => {
  vi.useFakeTimers();
  const h = harness();
  for (const path of ['popup.html', 'offscreen.html']) {
    for (const action of ['accounts', 'login', 'logout', 'models', 'generate']) {
      const client = h.connect(`chrome-extension://extension/${path}`);
      client.receive({ action, accountId: 'legacy' });
      expect(client.port.postMessage).toHaveBeenCalledWith({
        type: 'error',
        message: expect.stringContaining('Standalone ChatGPT sign-in has retired'),
      });
    }
  }
  expect(h.connectNative).not.toHaveBeenCalled();
});
it('cancels a storage request after caller disconnection and ignores late results', () => {
  vi.useFakeTimers();
  const h = harness();
  const ui = h.connect('chrome-extension://extension/library.html');
  ui.receive({ action: 'config-read', section: 'settings' });
  const packet = h.native.postMessage.mock.calls[0]![0];
  expect(packet.request).toEqual({ action: 'config-read', section: 'settings' });
  ui.disconnect();
  expect(h.native.postMessage).toHaveBeenLastCalledWith({ id: packet.id, cancel: true });
  h.emit({ id: packet.id, event: { type: 'result', config: { revision: 0, value: {} } } });
  expect(ui.port.postMessage).not.toHaveBeenCalled();
});

it('allows trusted history operations and rejects invalid migration identities', async () => {
  vi.useFakeTimers();
  const h = harness();
  const invalid = h.connect('chrome-extension://extension/offscreen.html');
  invalid.receive({ action: 'history', request: { operation: 'import-begin', id: '../outside' } });
  expect(h.connectNative).not.toHaveBeenCalled();
  const runner = h.connect('chrome-extension://extension/offscreen.html');
  runner.receive({
    action: 'history',
    request: {
      operation: 'db',
      requestId: '33333333-3333-3333-3333-333333333333',
      owner: '11111111-1111-1111-1111-111111111111',
      message: { type: 'DB_GET_HISTORY', payload: {} },
    },
  });
  expect(h.connectNative).toHaveBeenCalledTimes(1);
  const packet = h.native.postMessage.mock.calls[0]![0];
  expect(packet.request.action).toBe('history');
  h.emit({ id: packet.id, event: { type: 'result', value: [] } });
  await vi.advanceTimersByTimeAsync(0);
  expect(runner.port.postMessage).toHaveBeenCalledWith({ type: 'result', value: [] });
});

it('settles a timed-out request even when its native connection cannot receive cancellation', async () => {
  vi.useFakeTimers();
  const h = harness();
  const ui = h.connect('chrome-extension://extension/library.html');
  ui.receive({ action: 'config-read', section: 'settings' });
  const id = h.native.postMessage.mock.calls[0]![0].id;
  h.native.postMessage.mockImplementationOnce(() => {
    throw new Error('Attempting to use a disconnected port');
  });
  await vi.advanceTimersByTimeAsync(190_000);
  expect(ui.port.postMessage).toHaveBeenCalledExactlyOnceWith({
    type: 'error',
    message: 'Saul storage request timed out.',
  });
  h.emit({ id, event: { type: 'result', config: { revision: 0, value: {} } } });
  expect(ui.port.postMessage).toHaveBeenCalledTimes(1);
});
