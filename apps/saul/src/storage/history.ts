import { requestHistory } from '../native/storage-client';
import { StorageDisconnected } from '../native/storage-connection';
import MigrationWorker from './migration-worker?worker';
import type { DbCall, DbRequest } from '../../shared/protocol/history-types.ts';
import {
  historyOperationPolicy,
  type HistoryRequest,
} from '../../shared/protocol/history-protocol.mts';
function canReconnectHistory(operation: string): boolean {
  const policy = historyOperationPolicy(operation);
  return policy === 'read' || policy === 'repeatable-write';
}
let ready: Promise<void> | undefined;
let owner = '';
export async function historyCall(request: HistoryRequest): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await requestHistory({ action: 'history', request });
    } catch (error) {
      if (
        !(error instanceof StorageDisconnected) ||
        request.operation !== 'db' ||
        !canReconnectHistory(request.message.type) ||
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
