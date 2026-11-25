import { afterEach, expect, it, vi } from 'vitest';
import type { HistoryRequest } from '../shared/protocol/history-protocol.mts';
import {
  historyRequestPolicy,
  validateHistoryRequest,
} from '../shared/protocol/history-protocol.mts';
import { StorageDisconnected } from '../src/native/storage-connection';
import { historyCall } from '../src/storage/history';

const mocked = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../src/native/storage-client', () => ({ requestHistory: mocked.call }));
const request = (command: HistoryRequest['command']): HistoryRequest => ({
  operation: 'history',
  owner: crypto.randomUUID(),
  operationId: crypto.randomUUID(),
  command,
});
afterEach(() => {
  vi.useRealTimers();
  mocked.call.mockReset();
});
it('reconnects with the same operation identity and stops after three connection attempts', async () => {
  vi.useFakeTimers();
  mocked.call
    .mockRejectedValueOnce(new StorageDisconnected('lost'))
    .mockRejectedValueOnce(new StorageDisconnected('lost'))
    .mockResolvedValue([]);
  const original = request({ kind: 'list', view: 'library.records', query: {} });
  const result = historyCall(original);
  await vi.runAllTimersAsync();
  await expect(result).resolves.toEqual([]);
  expect(mocked.call).toHaveBeenCalledTimes(3);
  expect(mocked.call.mock.calls.every(([value]) => value.request === original)).toBe(true);
});
it('never repeats uncertain destructive changes or an ordinary storage failure', async () => {
  for (const command of [
    { kind: 'clear', collection: 'library' },
    { kind: 'mask', target: { collection: 'library', id: 'saved' } },
    { kind: 'purge', target: { collection: 'calls', id: 'run' } },
    { kind: 'restore', target: { collection: 'annotations', id: 'note' } },
    {
      kind: 'commit',
      change: 'library.bookmark',
      input: { selectionId: 'saved', bookmarked: true },
    },
  ] as const) {
    const original = request(command);
    expect(historyRequestPolicy(original)).toBe('explicit-write');
    mocked.call.mockRejectedValueOnce(new StorageDisconnected('lost'));
    await expect(historyCall(original)).rejects.toThrow('may have been applied');
    expect(mocked.call).toHaveBeenCalledTimes(1);
    mocked.call.mockClear();
  }
  mocked.call.mockRejectedValueOnce(new Error('disk full'));
  await expect(
    historyCall(request({ kind: 'commit', change: 'reading.claim', input: { runId: 'r' } })),
  ).rejects.toThrow('disk full');
  expect(mocked.call).toHaveBeenCalledTimes(1);
});
it('rejects unsupported views and changes', () => {
  expect(() => validateHistoryRequest(request({ kind: 'list', view: 'future' }))).toThrow();
  expect(() => validateHistoryRequest(request({ kind: 'commit', change: 'future' }))).toThrow();
});

it('shares a single profile lookup across concurrent offscreen reads and retries a failed lookup', async () => {
  vi.resetModules();
  const owner = crypto.randomUUID();
  const sendMessage = vi
    .fn()
    .mockRejectedValueOnce(new Error('Profile unavailable'))
    .mockResolvedValue({ success: true, result: owner });
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  try {
    const { sharedDb } = await import('../src/storage/history');
    const read = () => sharedDb({ type: 'DB_UNREAD', payload: undefined });
    await expect(read()).rejects.toThrow('Profile unavailable');
    mocked.call.mockResolvedValue(0);
    expect(await Promise.all([read(), read()])).toEqual([0, 0]);
    expect(sendMessage.mock.calls).toEqual([
      [{ target: 'saul-history-identity' }],
      [{ target: 'saul-history-identity' }],
    ]);
    for (const [payload] of mocked.call.mock.calls)
      expect(payload.request).toMatchObject({
        operation: 'history',
        owner,
        command: { view: 'library.unread' },
      });
  } finally {
    vi.unstubAllGlobals();
  }
});
