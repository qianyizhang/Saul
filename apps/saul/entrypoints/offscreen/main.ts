import { DigestRunner } from '../../src/digest/runner';
import { captureSummarySource } from '../../src/digest/source';
import { sharedDb as db } from '../../src/storage/history';
import type { Reply } from '../../src/types/storage';
import type { RunnerRequest } from '../../src/storage/client';
import { ReadingRunner } from '../../src/reading/runner';
import { backgroundSender } from '../../src/contracts/reading';
import { ActionManager } from '../../src/actions/manager';
import type { ActionState } from '../../src/actions/contract';

const changed = (url: string) => {
  void chrome.runtime.sendMessage({ target: 'saul-events', url }).catch(() => undefined);
};
const digest = new DigestRunner(db, captureSummarySource);
// Chrome offscreen documents expose runtime only. Trusted storage stays behind the background.
async function actionStateRequest(action: 'read' | 'write', state?: ActionState) {
  const response: Reply<ActionState> = await chrome.runtime.sendMessage({
    target: 'saul-action-state',
    action,
    state,
  });
  if (!response?.success) throw new Error(response?.error || 'Action settings could not be saved.');
  return response.result;
}
const actions = new ActionManager(db, undefined, {
  read: () => actionStateRequest('read'),
  write: async (state) => {
    await actionStateRequest('write', state);
  },
});
void actions.ready.catch(() => undefined);
void digest.ready.catch(() => undefined);
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
        case 'digest':
          return digest.request(message.message, message.snapshot, message.credential);
        case 'action':
          return actions.request(message.message, message.prepared);
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
