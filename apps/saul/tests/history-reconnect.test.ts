import { afterEach, expect, it, vi } from 'vitest';
const mocked = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../src/models/chatgpt-plan', async () => {
  const actual = await vi.importActual<typeof import('../src/models/chatgpt-plan')>(
    '../src/models/chatgpt-plan',
  );
  return { ...actual, planCall: mocked.call };
});
import { HistoryDisconnected } from '../src/models/chatgpt-plan';
import { historyCall } from '../src/storage/history';
import { validateHistoryRequest, type HistoryRequest } from '../native/history-protocol.mts';
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
    .mockRejectedValueOnce(new HistoryDisconnected('lost'))
    .mockRejectedValueOnce(new HistoryDisconnected('lost'))
    .mockResolvedValue({ type: 'result', value: [] });
  const original = request('DB_GET_HISTORY');
  const result = historyCall(original);
  await vi.runAllTimersAsync();
  await expect(result).resolves.toEqual([]);
  expect(mocked.call).toHaveBeenCalledTimes(3);
  expect(mocked.call.mock.calls.every(([value]) => value.request === original)).toBe(true);
});
it('does not repeat an uncertain Clear or an ordinary storage failure', async () => {
  mocked.call.mockRejectedValueOnce(new HistoryDisconnected('lost'));
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
    mocked.call
      .mockRejectedValueOnce(new HistoryDisconnected('lost'))
      .mockResolvedValue({ type: 'result', value: null });
    const original = request(operation);
    validateHistoryRequest(original);
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
    mocked.call.mockRejectedValueOnce(new HistoryDisconnected('lost'));
    await expect(historyCall(message)).rejects.toThrow('lost');
  }
  expect(mocked.call).toHaveBeenCalledTimes(2);
});
