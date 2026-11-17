import { validateStorageHelperRequest } from '../../shared/protocol/storage-protocol.mts';
import { STORAGE_PORT } from '../../shared/protocol/storage-protocol.mts';
import { workspaceSender } from '../platform/chrome/sender';
import { StorageConnection, StorageDisconnected } from './storage-connection';

// Native messaging is available in the background, not the offscreen runner.
// Multiplex only allowlisted history/configuration operations; never expose a general proxy.
export function initStorageBridge() {
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.target !== 'saul-history-identity') return false;
    if (
      sender.id !== chrome.runtime.id ||
      sender.tab ||
      sender.url !== chrome.runtime.getURL('offscreen.html')
    ) {
      reply({ success: false, error: 'Offscreen history only.' });
      return false;
    }
    void chrome.storage.local
      .get('saul_history_identity')
      .then(async (value) => {
        const id =
          typeof value.saul_history_identity === 'string'
            ? value.saul_history_identity
            : crypto.randomUUID();
        if (value.saul_history_identity !== id)
          await chrome.storage.local.set({ saul_history_identity: id });
        reply({ success: true, result: id });
      })
      .catch((error) => reply({ success: false, error: String(error) }));
    return true;
  });

  const storage = new StorageConnection();
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== STORAGE_PORT) return;
    const sender = port.sender;
    const workspace = !!sender && workspaceSender(sender);
    const offscreen =
      sender?.id === chrome.runtime.id &&
      !sender.tab &&
      sender.url === chrome.runtime.getURL('offscreen.html');
    if (!workspace && !offscreen) {
      port.disconnect();
      return;
    }
    let active: AbortController | undefined;
    const post = (event: unknown) => {
      try {
        port.postMessage(event);
      } catch {
        // Caller closed.
      }
    };
    port.onMessage.addListener((message: unknown) => {
      if (active) {
        if (
          typeof message === 'object' &&
          message !== null &&
          'cancel' in message &&
          message.cancel === true
        ) {
          active.abort();
          post({ type: 'error', message: 'Saul storage request stopped.' });
        }
        return;
      }
      try {
        validateStorageHelperRequest(message);
        if (offscreen && message.action !== 'history')
          throw new Error('Runner may only request history.');
      } catch (error) {
        post({
          type: 'error',
          message: error instanceof Error ? error.message : 'Saul storage request failed.',
        });
        return;
      }
      const controller = new AbortController();
      active = controller;
      void storage.request(message, controller.signal).then(
        (event) => {
          if (!controller.signal.aborted) post(event);
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          post({
            type: 'error',
            ...(error instanceof StorageDisconnected &&
              message.action === 'history' && { reason: 'history-disconnected' }),
            message: error instanceof Error ? error.message : 'Saul storage request failed.',
          });
        },
      );
    });
    port.onDisconnect.addListener(() => active?.abort());
  });
}
