import {
  ACTION_PORT,
  validateActionGenerate,
  type ActionHostEvent,
  type ActionHostRequest,
  type ActionGenerate,
} from '../../native/action-protocol.mts';

export async function actionHost(
  request: ActionHostRequest,
  options: {
    signal?: AbortSignal;
    generate?: (request: ActionGenerate, signal: AbortSignal) => Promise<string>;
    progress?: (text: string) => void;
  } = {},
): Promise<Extract<ActionHostEvent, { type: 'result' }>> {
  options.signal?.throwIfAborted();
  const port = chrome.runtime.connect({ name: ACTION_PORT });
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    let ended = false;
    let cancelling = false;
    let cancelTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error, result?: Extract<ActionHostEvent, { type: 'result' }>) => {
      if (ended) return;
      ended = true;
      clearTimeout(cancelTimer);
      controller.abort();
      options.signal?.removeEventListener('abort', abort);
      port.disconnect();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => {
      if (ended || cancelling) return;
      cancelling = true;
      controller.abort();
      try {
        port.postMessage({ cancel: true });
      } catch (error) {
        finish(
          error instanceof Error ? error : new Error('Action helper disconnected during Stop.'),
        );
        return;
      }
      cancelTimer = setTimeout(
        () =>
          finish(
            new Error(
              'Model calls stopped, but action worker shutdown could not be confirmed. No work was replayed.',
            ),
          ),
        3000,
      );
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      finish(new Error('Action helper connection closed. No work was replayed.'));
    });
    port.onMessage.addListener((event: ActionHostEvent) => {
      if (ended) return;
      if (cancelling) {
        if (event.type === 'error' || event.type === 'result') finish(new Error('Stopped.'));
        return;
      }
      if (event.type === 'error') finish(new Error(event.message));
      else if (event.type === 'result') finish(undefined, event);
      else if (event.type === 'progress') options.progress?.(event.text);
      else if (event.type === 'generate') {
        void (async () => {
          validateActionGenerate(event.request);
          if (!options.generate) throw new Error('Model calls are unavailable while loading.');
          return options.generate(event.request, controller.signal);
        })().then(
          (text) => {
            if (!ended) port.postMessage({ callId: event.callId, text });
          },
          (error: unknown) => {
            if (!ended)
              port.postMessage({
                callId: event.callId,
                error: error instanceof Error ? error.message : String(error),
              });
          },
        );
      }
    });
    try {
      options.signal?.throwIfAborted();
      port.postMessage(request);
    } catch (error) {
      finish(error as Error);
    }
  });
}
