import { workspaceSender } from '../contracts/reading';
import type { UserSettings } from '../types';
import { credentialCall } from '../native/credentials';
import { generateSpeech, speechCredential, SPEECH_PORT, validateSpeechRequest } from './realtime';

export function initSpeechBridge(currentSettings: () => Promise<UserSettings>) {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== SPEECH_PORT) return;
    if (!port.sender || !workspaceSender(port.sender)) {
      port.disconnect();
      return;
    }
    const controller = new AbortController();
    let started = false;
    port.onDisconnect.addListener(() => controller.abort());
    port.onMessage.addListener((request: unknown) => {
      if (started) return;
      started = true;
      const signal = controller.signal;
      const timer = setTimeout(() => {
        if (signal.aborted) return;
        port.postMessage({ error: 'Speech timed out. Generate again to retry.' });
        controller.abort();
        port.disconnect();
      }, 90_000);
      signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
      void (async () => {
        validateSpeechRequest(request);
        const settings = await currentSettings();
        const key = speechCredential(settings, request);
        return generateSpeech(
          request,
          key,
          signal,
          key === undefined
            ? {
                authorize: async () => {
                  const result = await credentialCall(
                    { action: 'api-realtime', model: request.model, voice: request.voice },
                    signal,
                  );
                  if (typeof result.clientSecret !== 'string')
                    throw new Error('Saul returned an invalid Realtime authorization.');
                  return result.clientSecret;
                },
              }
            : {},
        );
      })()
        .then(
          (result) => {
            if (!controller.signal.aborted) port.postMessage({ result });
          },
          (error: unknown) => {
            if (!controller.signal.aborted)
              port.postMessage({
                error: error instanceof Error ? error.message : 'Speech failed.',
              });
          },
        )
        .finally(() => {
          clearTimeout(timer);
          port.disconnect();
        });
    });
  });
}
