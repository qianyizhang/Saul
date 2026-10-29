import {
  ACTION_HOST,
  ACTION_PORT,
  validateActionHostRequest,
  type ActionHostEvent,
} from '../../native/action-protocol.mts';

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
    port.onMessage.addListener((message) => {
      if (typeof message?.id === 'string' && message.event) finish(message.id, message.event);
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
    const sender = port.sender;
    if (
      sender?.id !== chrome.runtime.id ||
      sender.tab ||
      sender.url !== chrome.runtime.getURL('offscreen.html')
    ) {
      port.disconnect();
      return;
    }
    let id: string | undefined;
    port.onMessage.addListener((message) => {
      if (id) {
        if (message?.cancel === true) native?.postMessage({ id, cancel: true });
        else if (
          Number.isSafeInteger(message?.callId) &&
          (typeof message.text === 'string' || typeof message.error === 'string')
        )
          native?.postMessage({
            id,
            callId: message.callId,
            text: message.text,
            error: message.error,
          });
        return;
      }
      try {
        validateActionHostRequest(message);
        id = crypto.randomUUID();
        const requestId = id;
        const timer = setTimeout(
          () => {
            native?.postMessage({ id: requestId, cancel: true });
            finish(requestId, {
              type: 'error',
              message: 'Action helper timed out. Retry explicitly.',
            });
          },
          message.action === 'run' ? 320_000 : 30_000,
        );
        requests.set(id, { port, timer });
        connect().postMessage({ id, request: message });
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
      native?.postMessage({ id, cancel: true });
    });
  });
}
