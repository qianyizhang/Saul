import {
  STORAGE_PORT,
  validateStorageResult,
  type StorageHelperRequest,
} from '../../shared/protocol/storage-protocol.mts';
import { isRecord } from '../../shared/model/value.mts';
import { StorageDisconnected } from './storage-connection';

/** Offscreen storage access. Configuration writes run directly in the background. */
export async function requestHistory(
  request: Extract<StorageHelperRequest, { action: 'history' }>,
) {
  const port = chrome.runtime.connect({ name: STORAGE_PORT });
  try {
    return await new Promise((resolve, reject) => {
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        reject(new StorageDisconnected('Saul storage bridge disconnected. Retry from Settings.'));
      });
      port.onMessage.addListener((event: unknown) => {
        try {
          if (isRecord(event) && event.type === 'error' && typeof event.message === 'string') {
            if (event.reason === 'history-disconnected')
              throw new StorageDisconnected(event.message);
            throw new Error(event.message);
          }
          validateStorageResult(request, event);
          resolve(event.value);
        } catch (error) {
          reject(error);
        }
      });
      port.postMessage(request);
    });
  } finally {
    port.disconnect();
  }
}
