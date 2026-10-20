import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initNativeBridge, ENABLED_KEY, STATUS_KEY } from '../src/native/bridge';

const event = <Args extends unknown[]>() => {
  const listeners: Array<(...args: Args) => void> = [];
  return {
    addListener: (fn: (...args: Args) => void) => listeners.push(fn),
    fire: (...args: Args) => listeners.forEach((fn) => fn(...args)),
  };
};

const port = () => ({
  onMessage: event<[message: unknown]>(),
  onDisconnect: event<[]>(),
  postMessage: vi.fn(),
  disconnect: vi.fn(),
});

type TestPort = ReturnType<typeof port>;
const testBrowser = (ports: TestPort[]) => ({
  runtime: {
    id: 'saul',
    lastError: undefined as { message: string } | undefined,
    onMessage:
      event<
        [
          message: unknown,
          sender: Partial<chrome.runtime.MessageSender>,
          reply: (response: unknown) => void,
        ]
      >(),
    getURL: (path: string) => 'chrome-extension://saul/' + path.replace(/^\//, ''),
    connectNative: vi.fn(() => {
      const value = port();
      ports.push(value);
      return value;
    }),
  },
  storage: {
    local: { get: vi.fn(async () => ({})) },
    session: { set: vi.fn(async () => {}) },
    onChanged: event<[changes: Record<string, { newValue?: unknown }>, area: string]>(),
  },
  alarms: {
    create: vi.fn(),
    clear: vi.fn(async () => true),
    onAlarm: event<[alarm: { name: string }]>(),
  },
});

let browser: ReturnType<typeof testBrowser>;
let ports: TestPort[];
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
beforeEach(() => {
  ports = [];
  browser = testBrowser(ports);
  vi.stubGlobal('chrome', browser as unknown as typeof chrome);
});
afterEach(() => vi.unstubAllGlobals());

it('does not connect until enabled and reports readiness only after the host handshake', async () => {
  initNativeBridge();
  await flush();
  expect(browser.runtime.connectNative).not.toHaveBeenCalled();
  browser.storage.onChanged.fire({ [ENABLED_KEY]: { newValue: true } }, 'local');
  expect(browser.runtime.connectNative).toHaveBeenCalledWith('com.saul.tabs');
  expect(browser.storage.session.set).toHaveBeenLastCalledWith({
    [STATUS_KEY]: expect.objectContaining({ state: 'connecting' }),
  });
  ports[0]!.onMessage.fire({ type: 'ready' });
  expect(browser.storage.session.set).toHaveBeenLastCalledWith({
    [STATUS_KEY]: expect.objectContaining({ state: 'connected' }),
  });
});
it('reconnects after disconnect via an alarm and stops retrying when disabled', async () => {
  browser.storage.local.get.mockResolvedValue({ [ENABLED_KEY]: true });
  initNativeBridge();
  await flush();
  browser.runtime.lastError = { message: 'Host exited' };
  ports[0]!.onDisconnect.fire();
  expect(browser.storage.session.set).toHaveBeenLastCalledWith({
    [STATUS_KEY]: expect.objectContaining({ state: 'disconnected', error: 'Host exited' }),
  });
  browser.alarms.onAlarm.fire({ name: 'saul-native-retry' });
  expect(ports).toHaveLength(2);
  browser.storage.onChanged.fire({ [ENABLED_KEY]: { newValue: false } }, 'local');
  expect(ports[1]!.disconnect).toHaveBeenCalledOnce();
  browser.alarms.onAlarm.fire({ name: 'saul-native-retry' });
  expect(ports).toHaveLength(2);
});
it('does not let a stale initial settings read undo a newer user choice', async () => {
  let finishRead!: (value: object) => void;
  browser.storage.local.get.mockReturnValue(
    new Promise((resolve) => {
      finishRead = resolve;
    }),
  );
  initNativeBridge();
  browser.storage.onChanged.fire({ [ENABLED_KEY]: { newValue: true } }, 'local');
  finishRead({});
  await flush();
  expect(ports[0]!.disconnect).not.toHaveBeenCalled();
});

it('allows reconnect from an extension page and rejects webpage callers', async () => {
  browser.storage.local.get.mockResolvedValue({ [ENABLED_KEY]: true });
  initNativeBridge();
  await flush();
  const denied = vi.fn();
  browser.runtime.onMessage.fire(
    { type: 'NATIVE_RECONNECT' },
    { url: 'https://example.com' },
    denied,
  );
  expect(denied).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  expect(ports).toHaveLength(1);
  const reply = vi.fn();
  browser.runtime.onMessage.fire(
    { type: 'NATIVE_RECONNECT' },
    { id: browser.runtime.id, url: 'chrome-extension://saul/popup.html' },
    reply,
  );
  expect(reply).toHaveBeenCalledWith({ success: true });
  expect(ports[0]!.disconnect).toHaveBeenCalledOnce();
  expect(ports).toHaveLength(2);
});
