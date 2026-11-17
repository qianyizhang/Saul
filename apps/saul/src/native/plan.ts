import { Fragments, packets } from '../../native/fragments.mts';
import {
  PLAN_HOST,
  PLAN_PORT,
  validateStorageHelperRequest,
  type StorageHelperRequest,
  type PlanEvent,
} from '../../native/plan-protocol.mts';
import { workspaceSender } from '../contracts/reading';

type BridgeRequest = {
  port: chrome.runtime.Port;
  native?: chrome.runtime.Port;
  request: StorageHelperRequest;
  timer: ReturnType<typeof setTimeout>;
};

// Native messaging is available in the background, not the offscreen runner.
// Multiplex only allowlisted history/configuration operations; never expose a general proxy.
export function initPlanBridge() {
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
  let native: chrome.runtime.Port | undefined;
  const requests = new Map<string, BridgeRequest>();
  const cancel = (id: string) => {
    try {
      requests.get(id)?.native?.postMessage({ id, cancel: true });
    } catch {
      // Transport loss can race a timeout or Stop. Settle from the owner.
    }
  };
  const finish = (id: string, event: PlanEvent) => {
    const entry = requests.get(id);
    if (!entry) return;
    if (['result', 'error', 'complete'].includes(event.type)) {
      clearTimeout(entry.timer);
      requests.delete(id);
    }
    try {
      entry.port.postMessage(event);
    } catch {
      /* Caller closed. */
    }
  };
  const connect = () => {
    if (native) return native;
    const port = chrome.runtime.connectNative(PLAN_HOST);
    native = port;
    const fragments = new Fragments();
    port.onMessage.addListener((packet) => {
      const message = fragments.accept(packet) as { id?: string; event?: PlanEvent } | undefined;
      if (!message) return;
      if (typeof message?.id !== 'string' || !message.event) return;
      if (message.event.type === 'result' || message.event.type === 'error')
        finish(message.id, message.event);
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (native !== port) return;
      native = undefined;
      for (const [id, entry] of requests) {
        if (entry.native !== port) continue;
        finish(id, {
          type: 'error',
          reason: entry.request.action === 'history' ? 'history-disconnected' : undefined,
          message:
            'Saul history/configuration helper disconnected. Update the helper in Settings and retry.',
        });
      }
    });
    return port;
  };
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PLAN_PORT) return;
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
    let id: string | undefined;
    port.onMessage.addListener((message: unknown) => {
      if (
        id &&
        typeof message === 'object' &&
        message !== null &&
        'cancel' in message &&
        message.cancel === true
      ) {
        cancel(id);
        finish(id, { type: 'error', message: 'Saul storage request stopped.' });
        return;
      }
      if (id) return; // One logical operation per extension port.
      try {
        validateStorageHelperRequest(message);
        if (offscreen && message.action !== 'history')
          throw new Error('Runner may only request history.');
        id = crypto.randomUUID();
        const currentId = id;
        const timer = setTimeout(() => {
          cancel(currentId);
          finish(currentId, { type: 'error', message: 'Saul storage request timed out.' });
        }, 190_000);
        const entry: BridgeRequest = { port, request: message, timer };
        requests.set(id, entry);
        const frames = packets({ id, request: message });
        try {
          const connection = connect();
          entry.native = connection;
          for (const packet of frames) connection.postMessage(packet);
        } catch (error) {
          finish(id, {
            type: 'error',
            reason: message.action === 'history' ? 'history-disconnected' : undefined,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      } catch (error) {
        const event: PlanEvent = {
          type: 'error',
          message: error instanceof Error ? error.message : 'Saul storage request failed.',
        };
        if (id) finish(id, event);
        else port.postMessage(event);
      }
    });
    port.onDisconnect.addListener(() => {
      if (!id) return;
      const entry = requests.get(id);
      if (entry) {
        cancel(id);
        clearTimeout(entry.timer);
        requests.delete(id);
      }
    });
  });
}
