import DatabaseWorker from '../../src/storage/db-worker?worker';
import type { DbCall, Reply } from '../../src/types/storage';
import type { RunnerRequest } from '../../src/storage/client';
import { ReadingRunner } from '../../src/reading/runner';
import { backgroundSender } from '../../src/contracts/reading';

const worker = new DatabaseWorker();
let nextId = 0;
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
let workerError: string | undefined;
worker.onmessage = ({ data }: MessageEvent<{ id: number; response: Reply<unknown> }>) => {
  const entry = pending.get(data.id);
  pending.delete(data.id);
  if (data.response.success) entry?.resolve(data.response.result);
  else entry?.reject(new Error(data.response.error));
};
worker.onerror = (event) => {
  workerError = event.message || 'Database worker failed. Reload the extension to retry.';
  for (const entry of pending.values()) entry.reject(new Error(workerError));
  pending.clear();
};
const db: DbCall = (message) =>
  new Promise((resolve, reject) => {
    if (workerError) {
      reject(new Error(workerError));
      return;
    }
    const id = ++nextId;
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    worker.postMessage({ id, message });
  });
const changed = (url: string) => {
  void chrome.runtime.sendMessage({ target: 'saul-events', url }).catch(() => undefined);
};
const runner = new ReadingRunner(db, changed);
// Reconciliation starts once per actual offscreen incarnation, never per UI/worker connection.
void runner.ready.catch(() => undefined);
chrome.runtime.onMessage.addListener(
  (message: RunnerRequest & { target?: string }, sender, reply) => {
    if (message?.target !== 'saul-offscreen') return false;
    if (!backgroundSender(sender)) {
      reply({ success: false, error: 'Background only' });
      return false;
    }
    (async () => {
      await runner.ready;
      switch (message.operation) {
        case 'submit':
          return runner.submit(message.submission, message.credential);
        case 'stop':
          return runner.stop(message.selectionId);
        case 'delete':
          return runner.remove(message.selectionId);
        case 'db': {
          if (message.message.type === 'DB_GET_HISTORY')
            return (await db(message.message)).map((item) => ({
              ...item,
              latest: runner.decorateRun(item.selectionId, item.latest),
            }));
          if (message.message.type === 'DB_RUNS') {
            const selectionId = message.message.payload.selectionId;
            return (await db(message.message)).map((run) => runner.decorateRun(selectionId, run));
          }
          if (message.message.type === 'DB_PAGE')
            return (await db(message.message)).map((p) => runner.decorate(p));
          if (message.message.type === 'DB_PASSAGE') {
            const p = await db(message.message);
            return p && runner.decorate(p);
          }
          const result = await db(message.message);
          if (['DB_VIEW', 'DB_SET_BOOKMARK'].includes(message.message.type)) changed('*');
          return result;
        }
        default:
          throw new Error('Unknown runner operation');
      }
    })().then(
      (result) => reply({ success: true, result }),
      (error) =>
        reply({ success: false, error: error instanceof Error ? error.message : String(error) }),
    );
    return true;
  },
);
