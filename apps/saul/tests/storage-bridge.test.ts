import { afterEach, expect, it, vi } from 'vitest';
import { initStorageBridge } from '../src/native/storage-bridge';
import { STORAGE_PORT } from '../shared/protocol/storage-protocol.mts';

const historyRead = {
  action: 'history',
  request: {
    operation: 'history',
    operationId: '33333333-3333-4333-8333-333333333333',
    owner: '11111111-1111-4111-8111-111111111111',
    command: { kind: 'list', view: 'library.legacy-list', query: {} },
  },
};
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
      name: STORAGE_PORT,
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
it('rejects tabs and extension views; only the offscreen runner can request history', () => {
  vi.useFakeTimers();
  const h = harness();
  expect(h.connect('https://example.test', true).port.disconnect).toHaveBeenCalled();
  expect(
    h.connect('chrome-extension://extension/content.js', true).port.disconnect,
  ).toHaveBeenCalled();
  for (const path of ['popup.html', 'library.html', 'summary-panel.html']) {
    const view = h.connect(`chrome-extension://extension/${path}`);
    expect(view.port.disconnect).toHaveBeenCalled();
    view.receive({ action: 'config-read', section: 'settings' });
  }
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
  for (const action of ['accounts', 'login', 'logout', 'models', 'generate']) {
    const client = h.connect('chrome-extension://extension/offscreen.html');
    client.receive({ action, accountId: 'legacy' });
    expect(client.port.postMessage).toHaveBeenCalledWith({
      type: 'error',
      message: expect.stringContaining('Standalone ChatGPT sign-in has retired'),
    });
  }
  expect(h.connectNative).not.toHaveBeenCalled();
});

it.each([
  [
    'Invalid ChatGPT request.',
    'Saul’s local storage helper is out of date. Update it, reload Saul in Chrome, and retry.',
  ],
  ['The page is outside the assigned scope.', 'The page is outside the assigned scope.'],
])(
  'reports a native write rejection without replaying the save (%s)',
  async (message, expected) => {
    vi.useFakeTimers();
    const h = harness();
    const runner = h.connect('chrome-extension://extension/offscreen.html');
    const annotation = {
      action: 'history',
      request: {
        ...historyRead.request,
        command: {
          kind: 'commit',
          change: 'library.bookmark',
          input: { selectionId: 'saved', bookmarked: true },
        },
      },
    };
    runner.receive(annotation);
    const packet = h.native.postMessage.mock.calls[0]![0];
    expect(packet.request).toEqual(annotation);
    h.emit({ id: packet.id, event: { type: 'error', message } });
    await vi.advanceTimersByTimeAsync(0);
    expect(runner.port.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: 'error',
      message: expected,
    });
    expect(h.native.postMessage).toHaveBeenCalledTimes(1);
  },
);

it('cancels a storage request after caller disconnection and ignores late results', () => {
  vi.useFakeTimers();
  const h = harness();
  const runner = h.connect('chrome-extension://extension/offscreen.html');
  runner.receive(historyRead);
  const packet = h.native.postMessage.mock.calls[0]![0];
  expect(packet.request).toEqual(historyRead);
  runner.disconnect();
  expect(h.native.postMessage).toHaveBeenLastCalledWith({ id: packet.id, cancel: true });
  h.emit({ id: packet.id, event: { type: 'result', value: [] } });
  expect(runner.port.postMessage).not.toHaveBeenCalled();
});

it('allows trusted history operations and rejects invalid operation identities', async () => {
  vi.useFakeTimers();
  const h = harness();
  const invalid = h.connect('chrome-extension://extension/offscreen.html');
  invalid.receive({
    action: 'history',
    request: { ...historyRead.request, operationId: 'invalid' },
  });
  expect(h.connectNative).not.toHaveBeenCalled();
  const runner = h.connect('chrome-extension://extension/offscreen.html');
  runner.receive(historyRead);
  expect(h.connectNative).toHaveBeenCalledTimes(1);
  const packet = h.native.postMessage.mock.calls[0]![0];
  expect(packet.request.action).toBe('history');
  h.emit({ id: packet.id, event: { type: 'result', value: [] } });
  await vi.advanceTimersByTimeAsync(0);
  expect(runner.port.postMessage).toHaveBeenCalledWith({ type: 'result', value: [] });
});

it('rejects nested unknown History write fields before opening the native port', () => {
  const h = harness();
  const runner = h.connect('chrome-extension://extension/offscreen.html');
  runner.receive({
    action: 'history',
    request: {
      ...historyRead.request,
      command: {
        kind: 'commit',
        change: 'calls.update-item',
        input: {
          id: 'call',
          item: {
            index: 0,
            tabId: 1,
            title: 'Page',
            url: 'https://example.test',
            status: 'queued',
            raw: '',
            extra: true,
          },
        },
      },
    },
  });
  expect(runner.port.postMessage).toHaveBeenCalledWith({
    type: 'error',
    message: expect.stringContaining('command.input.item.extra: unknown field'),
  });
  expect(h.connectNative).not.toHaveBeenCalled();
});

it('settles a timed-out request even when its native connection cannot receive cancellation', async () => {
  vi.useFakeTimers();
  const h = harness();
  const runner = h.connect('chrome-extension://extension/offscreen.html');
  runner.receive(historyRead);
  const id = h.native.postMessage.mock.calls[0]![0].id;
  h.native.postMessage.mockImplementationOnce(() => {
    throw new Error('Attempting to use a disconnected port');
  });
  await vi.advanceTimersByTimeAsync(190_000);
  expect(runner.port.postMessage).toHaveBeenCalledExactlyOnceWith({
    type: 'error',
    message: 'Saul storage request timed out.',
  });
  h.emit({ id, event: { type: 'result', value: [] } });
  expect(runner.port.postMessage).toHaveBeenCalledTimes(1);
});
