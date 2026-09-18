import { HOST_NAME } from '../../native/protocol.mjs';
import { handleTabCall } from './tabs';

export const ENABLED_KEY = 'saul_native_enabled';
export const STATUS_KEY = 'saul_native_status';
const RETRY_ALARM = 'saul-native-retry';

export function initNativeBridge() {
  let port: chrome.runtime.Port | undefined;
  let enabled = false;
  let queue = Promise.resolve();
  const status = (state: string, error?: string) =>
    chrome.storage.session.set({
      [STATUS_KEY]: { state, error, updatedAt: Date.now() },
    });
  const connect = () => {
    if (!enabled || port) return;
    void status('connecting');
    const current = chrome.runtime.connectNative(HOST_NAME);
    port = current;
    current.onMessage.addListener((message) => {
      if (message?.type === 'ready') {
        void status('connected');
        return;
      }
      if (!message || typeof message.id !== 'string' || typeof message.method !== 'string') return;
      // Serialize tab operations. A failed operation must not poison later calls.
      queue = queue
        .then(async () => {
          if (!enabled || port !== current) return;
          let response;
          try {
            response = {
              id: message.id,
              result: await handleTabCall(message.method, message.params),
            };
          } catch (error) {
            response = {
              id: message.id,
              error: {
                message: `${error instanceof Error ? error.message : error}. If applying changes, some may have completed; list tabs before retrying.`,
              },
            };
          }
          if (port === current) current.postMessage(response);
        })
        .catch((error) => console.warn('[Saul] Native response failed', error));
    });
    current.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message;
      if (port !== current) return;
      port = undefined;
      void status(enabled ? 'disconnected' : 'disabled', error);
    });
  };
  const setEnabled = (value: boolean) => {
    enabled = value;
    if (enabled) {
      // Alarms survive service-worker suspension; the native port keeps it alive
      // while connected. Retry at a bounded rate when the host is absent.
      chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 });
      connect();
    } else {
      void chrome.alarms.clear(RETRY_ALARM);
      const previous = port;
      port = undefined;
      previous?.disconnect();
      void status('disabled');
    }
  };
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RETRY_ALARM) connect();
  });
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type !== 'NATIVE_RECONNECT') return false;
    if (!sender.url?.startsWith(chrome.runtime.getURL('/'))) {
      reply({ success: false, error: 'Extension pages only' });
      return false;
    }
    if (!enabled) {
      reply({ success: false, error: 'Enable Codex access first.' });
      return false;
    }
    const previous = port;
    port = undefined;
    previous?.disconnect();
    try {
      connect();
      reply({ success: true });
    } catch (error) {
      reply({ success: false, error: String(error) });
    }
    return false;
  });
  let revision = 0;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[ENABLED_KEY]) {
      revision++;
      setEnabled(changes[ENABLED_KEY].newValue === true);
    }
  });
  const initialRevision = revision;
  void chrome.storage.local.get(ENABLED_KEY).then((data) => {
    if (revision === initialRevision) setEnabled(data[ENABLED_KEY] === true);
  });
}
