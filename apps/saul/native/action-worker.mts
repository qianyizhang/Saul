import { parentPort, workerData } from 'node:worker_threads';
import type { ActionGenerate, ActionSource } from './action-protocol.mts';
import { validateActionGenerate, ACTION_MAX_TEXT } from './action-protocol.mts';

const port = parentPort!;
const runs = new Map<string, AbortController>();
const pending = new Map<
  string,
  { resolve: (value: string) => void; reject: (error: Error) => void }
>();
const module = await import(
  'data:text/javascript;base64,' + Buffer.from(workerData.javascript).toString('base64')
);
if (typeof module.default !== 'function')
  throw new Error('The module must export a default run(ctx) function.');
port.on(
  'message',
  (message: {
    id: string;
    source?: ActionSource;
    cancel?: boolean;
    callId?: number;
    text?: string;
    error?: string;
  }) => {
    if (message.callId !== undefined) {
      const key = message.id + ':' + message.callId;
      const call = pending.get(key);
      pending.delete(key);
      if (message.error) call?.reject(new Error(message.error));
      else call?.resolve(message.text || '');
      return;
    }
    if (message.cancel) {
      runs.get(message.id)?.abort();
      for (const [key, call] of pending)
        if (key.startsWith(message.id + ':')) {
          call.reject(new Error('Stopped.'));
          pending.delete(key);
        }
      return;
    }
    if (!message.source || runs.has(message.id)) return;
    const controller = new AbortController();
    runs.set(message.id, controller);
    let calls = 0;
    const ctx = Object.freeze({
      source: Object.freeze(message.source),
      signal: controller.signal,
      progress: (text: string) => {
        if (typeof text !== 'string' || text.length > 500)
          throw new Error('Progress must be at most 500 characters.');
        controller.signal.throwIfAborted();
        port.postMessage({ id: message.id, event: { type: 'progress', text } });
      },
      generate: (request: ActionGenerate) => {
        controller.signal.throwIfAborted();
        validateActionGenerate(request);
        const callId = ++calls;
        return new Promise<string>((resolve, reject) => {
          pending.set(message.id + ':' + callId, { resolve, reject });
          port.postMessage({ id: message.id, event: { type: 'generate', callId, request } });
        });
      },
    });
    void Promise.resolve()
      .then(() => module.default(ctx))
      .then((text: unknown) => {
        controller.signal.throwIfAborted();
        if (typeof text !== 'string' || !text.trim() || text.length > ACTION_MAX_TEXT)
          throw new Error('The action must return nonempty text of at most 60,000 characters.');
        port.postMessage({ id: message.id, event: { type: 'result', text } });
      })
      .catch((error: unknown) => {
        port.postMessage({
          id: message.id,
          event: { type: 'error', message: error instanceof Error ? error.message : String(error) },
        });
      })
      .finally(() => runs.delete(message.id));
  },
);
port.postMessage({ ready: true });
