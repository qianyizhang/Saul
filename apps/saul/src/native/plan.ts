import { Fragments, packets } from '../../native/fragments.mts';
import {
  PLAN_HOST,
  PLAN_PORT,
  validatePlanRequest,
  type PlanRequest,
  type PlanEvent,
} from '../../native/plan-protocol.mts';
import { workspaceSender } from '../contracts/reading';

// Native messaging is available in the background, not the offscreen runner.
// Multiplex only allowlisted plan operations; never expose a general proxy.
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
  let historyNative: chrome.runtime.Port | undefined;
  const requests = new Map<
    string,
    { port: chrome.runtime.Port; request: PlanRequest; timer: ReturnType<typeof setTimeout> }
  >();
  const finish = (id: string, event: PlanEvent) => {
    const entry = requests.get(id);
    if (!entry) return;
    if (['result', 'error', 'complete'].includes(event.type)) {
      clearTimeout(entry.timer);
      requests.delete(id);
      if (entry.request.action === 'login') {
        // A popup closes when the authorization tab takes focus. Notify any
        // reopened Settings view; the account store remains the authority.
        void chrome.runtime
          .sendMessage({
            target: 'saul-plan-accounts',
            ...(event.type === 'result' && 'account' in event
              ? { accountId: event.account.id }
              : {}),
          })
          .catch(() => {});
      }
    }
    try {
      entry.port.postMessage(event);
    } catch {
      /* Caller closed. */
    }
  };
  const connect = (history = false) => {
    const current = history ? historyNative : native;
    if (current) return current;
    const port = chrome.runtime.connectNative(PLAN_HOST);
    if (history) historyNative = port;
    else native = port;
    const fragments = new Fragments();
    port.onMessage.addListener((packet) => {
      const message = fragments.accept(packet) as { id?: string; event?: PlanEvent } | undefined;
      if (!message) return;
      if (typeof message?.id !== 'string' || !message.event) return;
      const event = message.event as PlanEvent;
      const messageId = message.id;
      if (event.type === 'authorize') {
        // The native helper owns hints/tokens. Only open its official auth URL;
        // do not forward the URL to UI, storage, page scripts, or diagnostics.
        try {
          const url = new URL(event.url);
          if (
            url.origin !== 'https://auth.openai.com' ||
            url.pathname !== '/api/accounts/authorize'
          )
            throw new Error();
          if (requests.get(message.id)?.request.action !== 'login') throw new Error();
          void chrome.tabs.create({ url: event.url }).catch(() => {
            port.postMessage({ id: message.id, cancel: true });
            finish(messageId, { type: 'error', message: 'Could not open ChatGPT sign-in.' });
          });
        } catch {
          port.postMessage({ id: message.id, cancel: true });
          finish(message.id, { type: 'error', message: 'Invalid sign-in destination.' });
        }
      } else finish(message.id, event);
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if ((history ? historyNative : native) !== port) return;
      if (history) historyNative = undefined;
      else native = undefined;
      for (const id of [...requests.keys()].filter(
        (id) => (requests.get(id)?.request.action === 'history') === history,
      ))
        finish(id, {
          type: 'error',
          reason: history ? 'history-disconnected' : undefined,
          message: history
            ? 'Shared history helper disconnected or needs an update. Run the ChatGPT/history helper setup in Settings, then retry.'
            : 'ChatGPT helper disconnected or is not installed. Run the setup command in Settings, then retry.',
        });
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
        (requests.get(id)?.request.action === 'history' ? historyNative : native)?.postMessage({
          id,
          cancel: true,
        });
        return;
      }
      if (id) return; // One logical operation per extension port.
      try {
        validatePlanRequest(message);
        if (offscreen && message.action !== 'generate' && message.action !== 'history')
          throw new Error('Runner may only generate text.');
        id = crypto.randomUUID();
        const currentId = id;
        const timer = setTimeout(
          () => {
            (message.action === 'history' ? historyNative : native)?.postMessage({
              id: currentId,
              cancel: true,
            });
            finish(currentId, { type: 'error', message: 'ChatGPT request timed out.' });
          },
          message.action === 'login' ? 320_000 : 190_000,
        );
        requests.set(id, { port, request: message, timer });
        const frames = packets({ id, request: message });
        try {
          const connection = connect(message.action === 'history');
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
          message: error instanceof Error ? error.message : 'ChatGPT request failed.',
        };
        if (id) finish(id, event);
        else port.postMessage(event);
      }
    });
    port.onDisconnect.addListener(() => {
      if (!id) return;
      const entry = requests.get(id);
      if (entry?.request.action === 'login') return; // OAuth survives popup closure.
      if (entry) {
        clearTimeout(entry.timer);
        requests.delete(id);
        (entry.request.action === 'history' ? historyNative : native)?.postMessage({
          id,
          cancel: true,
        });
      }
    });
  });
}
