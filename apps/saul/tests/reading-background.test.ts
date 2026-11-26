import { afterEach, expect, it, vi } from 'vitest';
import type { DbCall } from '../shared/protocol/history-types.ts';
import { initReadingHost } from '../src/reading/background';
import { NOTIFICATION_STORAGE_KEY } from '../src/storage/notifications';

type MessageListener = (
  request: unknown,
  sender: chrome.runtime.MessageSender,
  reply: (value: unknown) => void,
) => boolean;

function event<Args extends unknown[], Result = void>() {
  const listeners: ((...args: Args) => Result)[] = [];
  return {
    listeners,
    addListener(listener: (...args: Args) => Result) {
      listeners.push(listener);
    },
    emit(...args: Args) {
      for (const listener of listeners) listener(...args);
    },
  };
}

function harness() {
  const onMessage = event<Parameters<MessageListener>, boolean>();
  const onConnect = event<[chrome.runtime.Port]>();
  const onChanged = event<[Record<string, chrome.storage.StorageChange>, string]>();
  const onRemoved = event<[number]>();
  const notification = Promise.withResolvers<Record<string, unknown>>();
  const remove = vi.fn(async () => {});
  const db = vi.fn(async () => 0);
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'reading-host',
      getURL: (path: string) => 'chrome-extension://reading-host/' + path,
      onMessage,
      onConnect,
    },
    tabs: { onRemoved },
    storage: {
      onChanged,
      local: {
        get: vi.fn((key) =>
          key === NOTIFICATION_STORAGE_KEY ? notification.promise : Promise.resolve({}),
        ),
      },
      session: { remove },
    },
    action: { setBadgeText: vi.fn(async () => {}) },
  });
  const source = {
    id: 'reading-host',
    frameId: 0,
    url: 'https://example.com/article',
    tab: { id: 1, url: 'https://example.com/article' } as chrome.tabs.Tab,
  };
  initReadingHost(db as unknown as DbCall, async () => {
    throw new Error('Unused fixture');
  });
  const send = (message: unknown, sender: chrome.runtime.MessageSender = source) =>
    new Promise<unknown>((resolve) => {
      expect(onMessage.listeners[0]!(message, sender, resolve)).toBe(true);
    });
  return { onConnect, onChanged, onRemoved, notification, remove, db, source, send };
}

afterEach(() => vi.unstubAllGlobals());

it('keeps the latest preference across a failed initial read and stops notifying disconnected pages', async () => {
  const h = harness();
  const onDisconnect = event<[]>();
  const postMessage = vi.fn();
  h.onConnect.emit({
    name: 'saul-reading',
    sender: h.source,
    onDisconnect,
    postMessage,
  } as unknown as chrome.runtime.Port);
  h.onChanged.emit({ [NOTIFICATION_STORAGE_KEY]: { newValue: true } }, 'local');
  h.notification.reject(new Error('Initial read lost'));
  await vi.waitFor(() =>
    expect(postMessage).toHaveBeenCalledWith({ type: 'presentation', minimum: true }),
  );
  expect(postMessage.mock.calls.filter(([value]) => value.type === 'notifications')).toEqual([
    [{ type: 'notifications', muted: true }],
  ]);
  onDisconnect.emit();
  h.onChanged.emit({ [NOTIFICATION_STORAGE_KEY]: { newValue: false } }, 'local');
  expect(postMessage).toHaveBeenCalledTimes(2);
  h.onRemoved.emit(1);
  expect(h.remove).toHaveBeenCalledWith('saul-source-1');
});

it('keeps source, workspace and runner authority separate', async () => {
  const h = harness();
  expect(await h.send({ target: 'saul-events', url: '*' })).toEqual({
    success: false,
    error: 'Runner only',
  });
  expect(await h.send({ target: 'saul-open-source', selectionId: 'passage' })).toEqual({
    success: false,
    error: 'Extension workspace only',
  });
  expect(
    await h.send(
      { target: 'saul-reading', message: { action: 'list' } },
      { ...h.source, frameId: 1 },
    ),
  ).toEqual({
    success: false,
    error: 'Reading requests require a source page',
  });
  expect(h.db.mock.calls).toHaveLength(1);
  const runner = { id: h.source.id, url: 'chrome-extension://reading-host/offscreen.html' };
  expect(await h.send({ target: 'saul-events', url: '*' }, runner)).toEqual({
    success: true,
    result: undefined,
  });
  expect(h.db.mock.calls).toHaveLength(2);
});
