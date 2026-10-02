import { afterEach, expect, it, vi } from 'vitest';
import { initPlanBridge } from '../src/native/plan';
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
      onConnect: {
        addListener: (fn: typeof accept) => {
          accept = fn;
        },
      },
      connectNative,
    },
    tabs: { create: vi.fn().mockResolvedValue({}) },
  });
  initPlanBridge();
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
it('rejects page callers and limits the offscreen runner to generation', () => {
  vi.useFakeTimers();
  const h = harness();
  expect(h.connect('https://example.test', true).port.disconnect).toHaveBeenCalled();
  expect(
    h.connect('chrome-extension://extension/content.js', true).port.disconnect,
  ).toHaveBeenCalled();
  const runner = h.connect('chrome-extension://extension/offscreen.html');
  runner.receive({ action: 'login' });
  expect(runner.port.postMessage).toHaveBeenCalledWith({
    type: 'error',
    message: 'Runner may only generate text.',
  });
  expect(h.connectNative).not.toHaveBeenCalled();
});
it('does not proxy caller-supplied endpoints and cancels generation on caller loss', () => {
  vi.useFakeTimers();
  const h = harness();
  const ui = h.connect('chrome-extension://extension/library.html');
  ui.receive({ action: 'models', accountId: 'account', url: 'https://evil.test' });
  expect(h.connectNative).not.toHaveBeenCalled();
  const runner = h.connect('chrome-extension://extension/offscreen.html');
  runner.receive({
    action: 'generate',
    accountId: 'account',
    model: 'model',
    systemPrompt: 'system',
    userPrompt: 'user',
  });
  const id = h.native.postMessage.mock.calls[0]![0].id;
  runner.disconnect();
  expect(h.native.postMessage).toHaveBeenLastCalledWith({ id, cancel: true });
});
it('keeps OAuth running after popup closure and rejects non-OpenAI authorization destinations', () => {
  vi.useFakeTimers();
  const h = harness();
  const ui = h.connect('chrome-extension://extension/popup.html');
  ui.receive({ action: 'login' });
  const id = h.native.postMessage.mock.calls[0]![0].id;
  ui.disconnect();
  expect(h.native.postMessage).toHaveBeenCalledTimes(1);
  h.emit({ id, event: { type: 'authorize', url: 'https://evil.test/sign-in' } });
  expect(chrome.tabs.create).not.toHaveBeenCalled();
  expect(h.native.postMessage).toHaveBeenLastCalledWith({ id, cancel: true });
});
