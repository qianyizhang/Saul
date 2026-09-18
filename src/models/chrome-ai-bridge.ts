import { ensureOffscreenDocument } from '../storage/client';
import type { ChromeAiConfig } from './chrome-ai';
export async function* streamChromeAiOffscreen(
  config: ChromeAiConfig,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  await ensureOffscreenDocument();
  if (signal?.aborted) return;
  const port = chrome.runtime.connect({ name: 'saul-local-model' });
  const chunks: string[] = [];
  let done = false,
    error: Error | undefined;
  let wake: (() => void) | undefined;
  const abort = () => {
    done = true;
    port.disconnect();
    wake?.();
  };
  port.onMessage.addListener((message) => {
    if (message.type === 'chunk') chunks.push(message.text);
    if (message.type === 'done') done = true;
    if (message.type === 'error') {
      error = new Error(message.message);
      done = true;
    }
    wake?.();
  });
  port.onDisconnect.addListener(() => {
    if (!done && !signal?.aborted)
      error = new Error(chrome.runtime.lastError?.message || 'On-device model disconnected.');
    done = true;
    wake?.();
  });
  signal?.addEventListener('abort', abort, { once: true });
  port.postMessage({ config, systemPrompt, userPrompt });
  try {
    while (!done || chunks.length) {
      if (signal?.aborted) return;
      if (chunks.length) {
        yield chunks.shift()!;
        continue;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
    if (error) throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    port.disconnect();
  }
}
