import { Fragments, packets } from '../../shared/protocol/fragments.mts';

type Control = (host: string, envelope: { id: string; request: never }) => Promise<unknown>;

declare global {
  function setStorageControlFixture(handle: Control): void;
}

// Included only in disposable test extension snapshots, before the background starts.
declare const __SAUL_HISTORY_ENDPOINT__: string;
function installHistoryTransport(endpoint: string) {
  let control: Control | undefined;
  globalThis.setStorageControlFixture = (handle) => {
    control = handle;
  };
  void chrome.storage.local.set({ saul_test_history_url: endpoint });
  let fallback = chrome.runtime.connectNative.bind(chrome.runtime);
  Object.defineProperty(chrome.runtime, 'connectNative', {
    configurable: true,
    get: () => {
      const previous = fallback;
      return (host: string) => {
        if (host !== 'com.saul.chatgpt') return previous(host);
        const listeners: ((event: unknown) => void)[] = [];
        const disconnected: (() => void)[] = [];
        const fragments = new Fragments();
        let closed = false;
        const emit = (event: unknown) => {
          if (!closed)
            for (const frame of packets(event)) listeners.forEach((listener) => listener(frame));
        };
        return {
          onMessage: {
            addListener: (listener: (event: unknown) => void) => listeners.push(listener),
          },
          onDisconnect: {
            addListener: (listener: () => void) => disconnected.push(listener),
          },
          disconnect: () => {
            closed = true;
          },
          postMessage: (frame: unknown) => {
            const packet = fragments.accept(frame) as
              { id: string; request?: { action: string; request: unknown } } | undefined;
            if (!packet?.request) return;
            if (packet.request?.action === 'history') {
              const id = packet.id;
              void fetch(endpoint, {
                method: 'POST',
                body: JSON.stringify(packet.request.request),
              })
                .then(async (response) => {
                  const value = (await response.json()) as {
                    success: boolean;
                    result: unknown;
                    error?: string;
                  };
                  emit({
                    id,
                    event: value.success
                      ? { type: 'result', value: value.result }
                      : { type: 'error', message: value.error },
                  });
                })
                .catch((error) => emit({ id, event: { type: 'error', message: String(error) } }));
              return;
            }
            void Promise.resolve()
              .then(async () => {
                const reply = await control?.(host, {
                  id: packet.id,
                  request: packet.request as never,
                });
                if (reply !== undefined) emit(reply);
                else if (!closed) disconnected.forEach((listener) => listener());
              })
              .catch((error) =>
                emit({
                  id: packet.id,
                  event: {
                    type: 'error',
                    message: error instanceof Error ? error.message : String(error),
                  },
                }),
              );
          },
        } as unknown as chrome.runtime.Port;
      };
    },
    set: (value: typeof chrome.runtime.connectNative) => {
      fallback = value;
    },
  });
}
installHistoryTransport(__SAUL_HISTORY_ENDPOINT__);
