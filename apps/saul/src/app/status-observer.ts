export interface StatusSnapshot<T> {
  value?: T;
  error?: string;
}

export interface StatusObserver<T> {
  /** Read now or join the latest requested read. */
  refresh(): Promise<void>;
  /** Optionally publish a command reply, then read again after any in-flight read. */
  invalidate(value?: T): Promise<void>;
  /** Ignore in-flight results and cancel scheduled work. */
  dispose(): void;
}

type Read = { done: Promise<void>; finish: () => void; obsolete?: boolean };
function pendingRead(): Read {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { done: promise, finish: resolve };
}

/** Observe one identity. The passed read must not start, stop or repeat work. */
export function createStatusObserver<T>({
  read,
  shouldPoll,
  onSnapshot,
  intervalMs = 700,
  maxDelayMs = 8_000,
}: {
  read: () => Promise<T>;
  shouldPoll: (value: T) => boolean;
  onSnapshot: (snapshot: StatusSnapshot<T>) => void;
  intervalMs?: number;
  maxDelayMs?: number;
}): StatusObserver<T> {
  let snapshot: StatusSnapshot<T> = {};
  let inFlight: Read | undefined;
  let trailing: Read | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let failures = 0;

  function publish(next: StatusSnapshot<T>) {
    snapshot = next;
    onSnapshot(next);
  }

  function start(job = pendingRead()) {
    inFlight = job;
    void run(job);
    return job.done;
  }

  async function run(job: Read) {
    try {
      const value = await read();
      if (!disposed && !job.obsolete) {
        failures = 0;
        publish({ value });
      }
    } catch (cause) {
      if (!disposed && !job.obsolete) {
        failures++;
        publish({
          ...snapshot,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    } finally {
      inFlight = undefined;
      if (!disposed && trailing) {
        const next = trailing;
        trailing = undefined;
        void start(next).then(job.finish);
      } else {
        job.finish();
        if (
          !disposed &&
          (failures || (snapshot.value !== undefined && shouldPoll(snapshot.value)))
        ) {
          const delay = failures
            ? Math.min(intervalMs * 2 ** (failures - 1), maxDelayMs)
            : intervalMs;
          timer = setTimeout(() => void refresh(), delay);
        }
      }
    }
  }

  function refresh() {
    clearTimeout(timer);
    if (disposed) return Promise.resolve();
    return trailing?.done ?? inFlight?.done ?? start();
  }

  return {
    refresh,
    invalidate(value) {
      if (disposed) return Promise.resolve();
      if (value !== undefined) {
        failures = 0;
        publish({ value });
      }
      if (!inFlight) return refresh();
      inFlight.obsolete = true;
      trailing ??= pendingRead();
      return trailing.done;
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      inFlight?.finish();
      trailing?.finish();
      trailing = undefined;
    },
  };
}
