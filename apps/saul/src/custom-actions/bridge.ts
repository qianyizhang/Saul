import { isRecord } from '../../shared/model/value.mts';
import {
  ACTION_HOST,
  ACTION_PORT,
  validateActionHostRequest,
  validateActionHostEvent,
  isActionCallback,
  type ActionNativeMessage,
  type ActionHostEvent,
} from '../../shared/protocol/action-protocol.mts';
import { offscreenSender } from '../platform/chrome/sender';

// Only the offscreen execution owner can talk to the action host. Source pages never can.
export function initActionBridge() {
  let native: chrome.runtime.Port | undefined;
  const requests = new Map<
    string,
    { port: chrome.runtime.Port; timer: ReturnType<typeof setTimeout> }
  >();
  const finish = (id: string, event: ActionHostEvent) => {
    const entry = requests.get(id);
    if (!entry) return;
    if (event.type === 'result' || event.type === 'error') {
      clearTimeout(entry.timer);
      requests.delete(id);
    }
    try {
      entry.port.postMessage(event);
    } catch {
      /* View or runner closed. */
    }
  };
  const connect = () => {
    if (native) return native;
    const port = chrome.runtime.connectNative(ACTION_HOST);
    native = port;
    port.onMessage.addListener((message: unknown) => {
      if (!isRecord(message) || typeof message.id !== 'string') return;
      try {
        validateActionHostEvent(message.event);
        finish(message.id, message.event);
      } catch {
        finish(message.id, { type: 'error', message: 'Action helper returned an invalid event.' });
      }
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (native !== port) return;
      native = undefined;
      for (const id of [...requests.keys()])
        finish(id, {
          type: 'error',
          message:
            'Action helper disconnected or is unavailable. Install the optional actions helper, then retry explicitly. No work was replayed.',
        });
    });
    return port;
  };
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== ACTION_PORT) return;
    if (!offscreenSender(port.sender)) {
      port.disconnect();
      return;
    }
    let id: string | undefined;
    port.onMessage.addListener((message: unknown) => {
      if (id) {
        if (isRecord(message) && message.cancel === true)
          native?.postMessage({ id, cancel: true } satisfies ActionNativeMessage);
        else if (isActionCallback(message)) {
          const { callId, text, error } = message;
          if (typeof text === 'string')
            native?.postMessage({ id, callId, text, error } satisfies ActionNativeMessage);
          else if (typeof error === 'string')
            native?.postMessage({ id, callId, error } satisfies ActionNativeMessage);
        }
        return;
      }
      try {
        validateActionHostRequest(message);
        id = crypto.randomUUID();
        const requestId = id;
        const timer = setTimeout(
          () => {
            native?.postMessage({ id: requestId, cancel: true } satisfies ActionNativeMessage);
            finish(requestId, {
              type: 'error',
              message: 'Action helper timed out. Retry explicitly.',
            });
          },
          message.action === 'run' ? 320_000 : 30_000,
        );
        requests.set(id, { port, timer });
        connect().postMessage({ id, request: message } satisfies ActionNativeMessage);
      } catch (error) {
        const event = { type: 'error' as const, message: (error as Error).message };
        if (id) finish(id, event);
        else port.postMessage(event);
      }
    });
    port.onDisconnect.addListener(() => {
      if (!id) return;
      const entry = requests.get(id);
      if (!entry) return;
      clearTimeout(entry.timer);
      requests.delete(id);
      native?.postMessage({ id, cancel: true } satisfies ActionNativeMessage);
    });
  });
}
