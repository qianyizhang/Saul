import { afterEach, expect, it, vi } from 'vitest';
const mocked = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../src/native/storage-client', () => ({ requestHistory: mocked.call }));
import { StorageDisconnected } from '../src/native/storage-connection';
import { historyCall } from '../src/storage/history';
import {
  historyOperationPolicy,
  validateHistoryRequest,
  type HistoryRequest,
} from '../shared/protocol/history-protocol.mts';
const request = (type: string): HistoryRequest => ({
  operation: 'db',
  owner: crypto.randomUUID(),
  requestId: crypto.randomUUID(),
  message: { type },
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
  const original = request('DB_GET_HISTORY');
  const result = historyCall(original);
  await vi.runAllTimersAsync();
  await expect(result).resolves.toEqual([]);
  expect(mocked.call).toHaveBeenCalledTimes(3);
  expect(mocked.call.mock.calls.every(([value]) => value.request === original)).toBe(true);
});
it('does not repeat an uncertain Clear or an ordinary storage failure', async () => {
  mocked.call.mockRejectedValueOnce(new StorageDisconnected('lost'));
  await expect(historyCall(request('DB_CLEAR_HISTORY'))).rejects.toThrow('lost');
  expect(mocked.call).toHaveBeenCalledTimes(1);
  mocked.call.mockRejectedValueOnce(new Error('disk full'));
  await expect(historyCall(request('DB_FINISH'))).rejects.toThrow('disk full');
  expect(mocked.call).toHaveBeenCalledTimes(2);
});

it.each([
  ['DB_GET_HISTORY', true],
  ['DB_SUBMIT', true],
  ['DB_CLAIM', true],
  ['DB_SAVING', true],
  ['DB_CHECKPOINT', true],
  ['DB_FINISH', true],
  ['DB_DIGEST_ITEM', true],
  ['DB_VIEW', true],
  ['DB_SET_BOOKMARK', false],
  ['DB_DELETE_SELECTION', false],
  ['DB_CLEAR_HISTORY', false],
  ['DB_DIGEST_DELETE', false],
] as const)(
  'reconnects safe operations but leaves explicit mutations uncertain: %s',
  async (operation, reconnect) => {
    vi.useFakeTimers();
    mocked.call.mockRejectedValueOnce(new StorageDisconnected('lost')).mockResolvedValue(null);
    const original = request(operation);
    expect(historyOperationPolicy(operation)).toBeDefined();
    const result = historyCall(original);
    if (!reconnect) {
      await expect(result).rejects.toThrow('lost');
      expect(mocked.call).toHaveBeenCalledTimes(1);
    } else {
      await vi.runAllTimersAsync();
      await expect(result).resolves.toBeNull();
      expect(mocked.call).toHaveBeenCalledTimes(2);
      expect(mocked.call.mock.calls.every(([value]) => value.request === original)).toBe(true);
    }
  },
);

it('rejects unknown operations and never reconnects them or migration transfers', async () => {
  expect(() => validateHistoryRequest(request('DB_FUTURE'))).toThrow('Invalid history operation');
  for (const message of [
    request('DB_FUTURE'),
    { operation: 'import-begin', id: crypto.randomUUID() } as const,
  ]) {
    mocked.call.mockRejectedValueOnce(new StorageDisconnected('lost'));
    await expect(historyCall(message)).rejects.toThrow('lost');
  }
  expect(mocked.call).toHaveBeenCalledTimes(2);
});
