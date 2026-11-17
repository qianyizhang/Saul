import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStatusObserver, type StatusSnapshot } from '../src/observation/status-observer';

type Status = 'working' | 'done';

afterEach(() => vi.useRealTimers());

describe('serialized status observation', () => {
  it('keeps the last value, backs off after failures, and stops after recovery to terminal', async () => {
    vi.useFakeTimers();
    const snapshots: StatusSnapshot<Status>[] = [];
    const read = vi
      .fn<() => Promise<Status>>()
      .mockResolvedValueOnce('working')
      .mockRejectedValueOnce(new Error('Reader offline'))
      .mockRejectedValueOnce(new Error('Reader still offline'))
      .mockRejectedValueOnce(new Error('Reader unavailable'))
      .mockResolvedValueOnce('working')
      .mockResolvedValue('done');
    const observer = createStatusObserver({
      read,
      shouldPoll: (value) => value === 'working',
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      intervalMs: 100,
      maxDelayMs: 250,
    });
    await observer.refresh();
    await vi.advanceTimersByTimeAsync(100);
    expect(snapshots.at(-1)).toEqual({ value: 'working', error: 'Reader offline' });
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(199);
    expect(read).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(249);
    expect(read).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(snapshots.at(-1)).toEqual({ value: 'working' });
    await vi.advanceTimersByTimeAsync(100);
    expect(snapshots.at(-1)).toEqual({ value: 'done' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(6);
    await observer.refresh();
    expect(read).toHaveBeenCalledTimes(7);
  });

  it.each(['success', 'failure'])(
    'joins in-flight reads, discards obsolete %s, and reads once after invalidation',
    async (outcome) => {
      vi.useFakeTimers();
      const snapshots: StatusSnapshot<Status>[] = [];
      const first = Promise.withResolvers<Status>();
      const fresh = Promise.withResolvers<Status>();
      const read = vi
        .fn<() => Promise<Status>>()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(fresh.promise);
      const observer = createStatusObserver({
        read,
        shouldPoll: (value) => value === 'working',
        onSnapshot: (snapshot) => snapshots.push(snapshot),
      });
      const initial = observer.refresh();
      expect(observer.refresh()).toBe(initial);
      const invalidated = observer.invalidate('working');
      expect(observer.invalidate()).toBe(invalidated);
      expect(observer.refresh()).toBe(invalidated);
      let finished = false;
      void Promise.all([initial, invalidated]).then(() => (finished = true));
      await vi.advanceTimersByTimeAsync(1000);
      expect(read).toHaveBeenCalledTimes(1);
      if (outcome === 'success') first.resolve('done');
      else first.reject(new Error('Late read failure'));
      await vi.advanceTimersByTimeAsync(0);
      expect(snapshots).toEqual([{ value: 'working' }]);
      expect(read).toHaveBeenCalledTimes(2);
      expect(finished).toBe(false);
      fresh.resolve('done');
      await Promise.all([initial, invalidated]);
      expect(snapshots).toEqual([{ value: 'working' }, { value: 'done' }]);
    },
  );

  it('disposes an in-flight read and its trailing refresh when the view exits', async () => {
    vi.useFakeTimers();
    const held = Promise.withResolvers<Status>();
    const read = vi.fn(() => held.promise);
    const onSnapshot = vi.fn();
    const observer = createStatusObserver({ read, shouldPoll: () => true, onSnapshot });
    const old = observer.refresh();
    const trailing = observer.invalidate();
    observer.dispose();
    await Promise.all([old, trailing]);
    held.resolve('working');
    await vi.advanceTimersByTimeAsync(10_000);
    await observer.refresh();
    expect(read).toHaveBeenCalledTimes(1);
    expect(onSnapshot).not.toHaveBeenCalled();
  });
});
