import DatabaseWorker from '../../src/storage/db-worker?worker';
import type { DbMessage } from '../../src/types/storage';

const worker = new DatabaseWorker();
let nextId = 0;
const pending = new Map<number, (response: unknown) => void>();
let workerError: string | null = null;

worker.onmessage = ({ data }) => {
  pending.get(data.id)?.(data.response);
  pending.delete(data.id);
};
worker.onerror = (event) => {
  workerError = event.message || 'Database worker failed. Reload the extension to retry.';
  for (const reply of pending.values()) reply({ success: false, error: workerError });
  pending.clear();
};

// Only the background routes requests here, after ensuring this document exists.
chrome.runtime.onMessage.addListener(
  (message: DbMessage & { target?: string }, _sender, sendResponse) => {
    if (message?.target !== 'saul-offscreen') return false;
    if (workerError) {
      sendResponse({ success: false, error: workerError });
      return false;
    }
    const id = ++nextId;
    pending.set(id, sendResponse);
    worker.postMessage({ id, message });
    return true;
  },
);

// The Prompt API requires a document context; the service worker only routes it.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'saul-local-model') return;
  if (
    port.sender?.tab ||
    (port.sender?.url && !port.sender.url.startsWith(chrome.runtime.getURL('/')))
  ) {
    port.disconnect();
    return;
  }
  const controller = new AbortController();
  let started = false;
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener(async (request) => {
    if (started) return;
    started = true;
    try {
      const { streamChromeAi } = await import('../../src/models/chrome-ai');
      for await (const text of streamChromeAi(
        request.config,
        request.systemPrompt,
        request.userPrompt,
        controller.signal,
      ))
        port.postMessage({ type: 'chunk', text });
      if (!controller.signal.aborted) port.postMessage({ type: 'done' });
    } catch (error) {
      if (!controller.signal.aborted)
        port.postMessage({ type: 'error', message: (error as Error).message });
    }
  });
});
