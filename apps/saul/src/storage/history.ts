import { HistoryDisconnected, planCall } from '../models/chatgpt-plan';
import MigrationWorker from './migration-worker?worker';
import type { DbCall, DbRequest } from '../types/storage';
import type { HistoryRequest } from '../../native/history-protocol.mts';
let ready: Promise<void> | undefined;
let owner = '';
const reconnectable = new Set([
  'DB_READING_RESOLVE',
  'DB_SUBMIT',
  'DB_RECOVER',
  'DB_CLAIM',
  'DB_SAVING',
  'DB_CHECKPOINT',
  'DB_FINISH',
  'DB_PAGE',
  'DB_PASSAGE',
  'DB_CONTEXT',
  'DB_INPUT',
  'DB_RUNS',
  'DB_VIEW',
  'DB_UNREAD',
  'DB_GET_HISTORY',
  'DB_EXPORT_MARKDOWN',
  'DB_IMAGE',
  'DB_DIGEST_FIND',
  'DB_DIGEST_ACTION_REVISIONS',
  'DB_DIGEST_CREATE',
  'DB_DIGEST_GET',
  'DB_DIGEST_LIST',
  'DB_DIGEST_ITEM',
  'DB_DIGEST_SOURCE',
  'DB_DIGEST_RECOVER',
]);
export async function historyCall(request: HistoryRequest): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      return (await planCall({ action: 'history', request })).value;
    } catch (error) {
      if (
        !(error instanceof HistoryDisconnected) ||
        request.operation !== 'db' ||
        !reconnectable.has(request.message.type) ||
        attempt >= 2
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
}
async function migrateHistory() {
  const worker = new MigrationWorker();
  const call = (action: 'export' | 'remove') =>
    new Promise<Uint8Array | undefined>((resolve, reject) => {
      worker.onmessage = ({ data }: MessageEvent<{ bytes?: Uint8Array; error?: string }>) =>
        data.error ? reject(new Error(data.error)) : resolve(data.bytes);
      worker.onerror = (event) =>
        reject(new Error(event.message || 'History migration worker failed.'));
      worker.postMessage(action);
    });
  try {
    // Connect first; helper loss must never activate a separate local history.
    const identity: { success: boolean; result: string; error?: string } =
      await chrome.runtime.sendMessage({ target: 'saul-history-identity' });
    if (!identity.success) throw new Error(identity.error);
    const id = identity.result;
    owner = id;
    const status = (await historyCall({ operation: 'import-begin', id })) as { imported: boolean };
    const bytes = await call('export');
    if (!status.imported) {
      if (bytes) {
        for (let offset = 0; offset < bytes.length; offset += 256 * 1024) {
          const chunk = bytes.subarray(offset, offset + 256 * 1024);
          let binary = '';
          for (const byte of chunk) binary += String.fromCharCode(byte);
          await historyCall({ operation: 'import-chunk', id, offset, data: btoa(binary) });
        }
        await historyCall({ operation: 'import-finish', id, size: bytes.length });
      } else {
        // Record the empty source too, so interrupted cleanup cannot reimport it.
        await historyCall({ operation: 'import-finish', id, size: 0 });
      }
    }
    await call('remove');
  } finally {
    worker.terminate();
  }
}
export const sharedDb: DbCall = async (message) => {
  if (!ready)
    ready = migrateHistory().catch((error) => {
      ready = undefined;
      throw error;
    });
  await ready;
  const value = await historyCall({
    operation: 'db',
    requestId: crypto.randomUUID(),
    owner,
    message: message as DbRequest,
  });
  return (value === null ? undefined : value) as never;
};
