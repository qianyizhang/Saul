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
import type { HistoryRequest } from '../native/history-protocol.mts';
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
