// Included only in disposable test extension snapshots, before the background starts.
declare const __SAUL_HISTORY_ENDPOINT__: string;
function installHistoryTransport(endpoint: string) {
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
        let delegate: chrome.runtime.Port | undefined;
        let fragments = '';
        const emit = (event: unknown) => listeners.forEach((listener) => listener(event));
        return {
          onMessage: {
            addListener: (listener: (event: unknown) => void) => listeners.push(listener),
          },
          onDisconnect: {
            addListener: (listener: () => void) => disconnected.push(listener),
          },
          disconnect: () => delegate?.disconnect(),
          postMessage: (packet: {
            fragment?: string;
            last?: boolean;
            id?: string;
            cancel?: boolean;
            request?: { action: string; request: unknown };
          }) => {
            if (packet.fragment !== undefined) {
              fragments += packet.fragment;
              if (!packet.last) return;
              packet = JSON.parse(fragments);
              fragments = '';
            }
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
            if (packet.cancel && !delegate) return;
            if (!delegate) {
              delegate = previous(host);
              delegate.onMessage.addListener(emit);
              delegate.onDisconnect.addListener(() =>
                disconnected.forEach((listener) => listener()),
              );
            }
            delegate.postMessage(packet);
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
