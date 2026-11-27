import { isRecord } from '../../shared/model/value.mts';
import { NATIVE_RECONNECT, type NativeReconnectReply } from './control-messages';
import { workspaceSender } from '../platform/chrome/sender';
import { HOST_NAME, MAX_MESSAGE } from '../../shared/protocol/native-messaging.mts';
import { isLocalAccessChange, readLocalAccess } from './local-access';
import { handleLocalToolCall } from './local-tool-call';

export const STATUS_KEY = 'saul_native_status';
const RETRY_ALARM = 'saul-native-retry';
export type NativeBridgeState = 'disabled' | 'connecting' | 'connected' | 'disconnected';
export interface NativeBridgeStatus {
  state: NativeBridgeState;
  error?: string;
  updatedAt?: number;
}
export function isNativeBridgeStatus(value: unknown): value is NativeBridgeStatus {
  if (typeof value !== 'object' || value === null) return false;
  const status = value as Record<string, unknown>;
  return (
    typeof status.state === 'string' &&
    ['disabled', 'connecting', 'connected', 'disconnected'].includes(status.state) &&
    (status.error === undefined || typeof status.error === 'string') &&
    (status.updatedAt === undefined || typeof status.updatedAt === 'number')
  );
}

export function initNativeBridge() {
  let port: chrome.runtime.Port | undefined;
  let enabled = false;
  let queue = Promise.resolve();
  const status = (state: NativeBridgeState, error?: string) =>
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
              result: await handleLocalToolCall(message.method, message.params),
            };
          } catch (error) {
            response = {
              id: message.id,
              error: {
                message: message.method.startsWith('saul_history_')
                  ? String(error instanceof Error ? error.message : error)
                  : `${error instanceof Error ? error.message : error}. If applying changes, some may have completed; list tabs before retrying.`,
              },
            };
          }
          if (port !== current) return;
          if (
            message.method === 'saul_annotations' &&
            new TextEncoder().encode(JSON.stringify(response) + '\n').byteLength > MAX_MESSAGE
          ) {
            // The storage budget normally handles this before commit. This is a final frame guard.
            current.postMessage({
              id: message.id,
              error: {
                message:
                  'Annotation response exceeds the bridge size limit. Review it in Saul before retrying.',
              },
            });
          } else current.postMessage(response);
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
    if (enabled === value && value) return;
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
  chrome.runtime.onMessage.addListener(
    (message: unknown, sender, reply: (value: NativeReconnectReply) => void) => {
      if (!isRecord(message) || message.type !== NATIVE_RECONNECT) return false;
      if (!workspaceSender(sender)) {
        reply({ success: false, error: 'Extension pages only' });
        return false;
      }
      if (!enabled) {
        reply({ success: false, error: 'Enable Local tool access first.' });
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
    },
  );
  let revision = 0;
  function refreshAccess() {
    const current = ++revision;
    void readLocalAccess()
      .then(({ enabled }) => {
        if (revision === current) setEnabled(enabled);
      })
      .catch((error) => {
        if (revision !== current) return;
        setEnabled(false);
        void status('disabled', String(error));
      });
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && isLocalAccessChange(changes)) refreshAccess();
  });
  refreshAccess();
}
