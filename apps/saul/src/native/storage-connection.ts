import { Fragments, packets } from '../../shared/protocol/fragments.mts';
import {
  STORAGE_HOST,
  validateStorageResult,
  validateStorageHelperRequest,
  type StorageResult,
  type StorageHelperRequest,
} from '../../shared/protocol/storage-protocol.mts';
import { isRecord } from '../../shared/model/value.mts';

export class StorageDisconnected extends Error {}
class MissingStorageAcknowledgement extends Error {}

type Pending = {
  accept(event: unknown): void;
  fail(error: Error): void;
};

/** One native port and one assembler; logical requests settle by ID. */
export class StorageConnection {
  private port?: chrome.runtime.Port;
  private readonly pending = new Map<string, Pending>();

  private connect() {
    if (this.port) return this.port;
    const port = chrome.runtime.connectNative(STORAGE_HOST);
    this.port = port;
    const fragments = new Fragments();
    port.onMessage.addListener((packet: unknown) => {
      if (this.port !== port) return;
      try {
        const reply = fragments.accept(packet);
        if (reply === undefined) return;
        if (!isRecord(reply) || typeof reply.id !== 'string')
          throw new Error('Invalid storage reply envelope.');
        this.pending.get(reply.id)?.accept(reply.event);
      } catch (cause) {
        this.close(
          new MissingStorageAcknowledgement('Saul storage helper returned an invalid reply.', {
            cause,
          }),
        );
      }
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (this.port !== port) return;
      this.port = undefined;
      this.failPending(
        new StorageDisconnected(
          'Saul’s local storage helper disconnected. Check the helper installation and retry.',
        ),
      );
    });
    return port;
  }

  private failPending(error: Error) {
    for (const pending of this.pending.values()) pending.fail(error);
  }

  close(error = new StorageDisconnected('Saul storage connection closed.')) {
    const port = this.port;
    this.port = undefined;
    this.failPending(error);
    port?.disconnect();
  }

  async request<T extends StorageHelperRequest>(
    request: T,
    signal?: AbortSignal,
  ): Promise<StorageResult<T>> {
    validateStorageHelperRequest(request);
    signal?.throwIfAborted();
    const id = crypto.randomUUID();
    const frames = packets({ id, request });
    let port: chrome.runtime.Port;
    try {
      port = this.connect();
    } catch (cause) {
      throw new StorageDisconnected('Could not connect to the Saul storage helper.', { cause });
    }
    return new Promise((resolve, reject) => {
      const settle = () => {
        this.pending.delete(id);
        clearTimeout(timer);
        signal?.removeEventListener('abort', stop);
      };
      const fail = (error: Error) => {
        settle();
        if (
          error instanceof MissingStorageAcknowledgement &&
          request.action === 'history' &&
          !('view' in request.request.command)
        )
          reject(
            new Error(
              error.message +
                ' The write may have been applied. Refresh the affected History view before trying again.',
              { cause: error },
            ),
          );
        else reject(error);
      };
      const cancel = () => {
        try {
          port.postMessage({ id, cancel: true });
        } catch {
          // The caller can stop waiting even if transport cancellation fails.
        }
      };
      const stop = () => {
        settle();
        cancel();
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        fail(new MissingStorageAcknowledgement('Saul storage request timed out.'));
        cancel();
      }, 190_000);
      this.pending.set(id, {
        accept(event) {
          try {
            if (isRecord(event) && event.type === 'error' && typeof event.message === 'string') {
              // The retired host rejected newer storage operations with this message.
              if (event.message === 'Invalid ChatGPT request.')
                throw new Error(
                  'Saul’s local storage helper is out of date. Update it, reload Saul in Chrome, and retry.',
                );
              throw new Error(event.message);
            }
            validateStorageResult(request, event);
            settle();
            resolve(event);
          } catch (error) {
            fail(error as Error);
          }
        },
        fail,
      });
      signal?.addEventListener('abort', stop, { once: true });
      try {
        for (const frame of frames) port.postMessage(frame);
      } catch (cause) {
        // A partially sent fragmented message cannot share this connection with
        // another request. Do not retry: the host may have committed the write.
        this.close(new StorageDisconnected('Saul storage request disconnected.', { cause }));
      }
    });
  }
}
