import { SPEECH_PORT, speechBlob, type SpeechRequest, type SpeechResult } from './realtime';

export function requestSpeech(request: SpeechRequest, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  const port = chrome.runtime.connect({ name: SPEECH_PORT });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result?: SpeechResult, error?: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      port.disconnect();
      if (error) reject(error);
      else {
        try {
          resolve(speechBlob(result!));
        } catch (cause) {
          reject(cause);
        }
      }
    };
    const abort = () => finish(undefined, new DOMException('Speech stopped.', 'AbortError'));
    port.onMessage.addListener((message: { result?: SpeechResult; error?: string }) => {
      if (typeof message.error === 'string') finish(undefined, new Error(message.error));
      else if (message.result) finish(message.result);
      else finish(undefined, new Error('Invalid speech reply.'));
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (!settled)
        finish(
          undefined,
          new Error('Speech connection closed before completion. Generate again to retry.'),
        );
    });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else port.postMessage(request);
  });
}
