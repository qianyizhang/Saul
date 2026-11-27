import { isRecord } from '../shared/model/value.mts';
import { parentPort, workerData } from 'node:worker_threads';
import type { ActionGenerate, ActionWorkerEvent } from '../shared/protocol/action-protocol.mts';
import {
  validateActionGenerate,
  validateActionSource,
  isActionCallback,
  ACTION_MAX_TEXT,
} from '../shared/protocol/action-protocol.mts';

const port = parentPort!;
const post = (message: ActionWorkerEvent) => port.postMessage(message);
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
port.on('message', (message: unknown) => {
  if (!isRecord(message) || typeof message.id !== 'string') return;
  const { id } = message;
  if (isActionCallback(message)) {
    const key = id + ':' + message.callId;
    const call = pending.get(key);
    pending.delete(key);
    if (message.error) call?.reject(new Error(message.error));
    else call?.resolve(message.text || '');
    return;
  }
  if (message.cancel === true) {
    runs.get(id)?.abort();
    for (const [key, call] of pending)
      if (key.startsWith(id + ':')) {
        call.reject(new Error('Stopped.'));
        pending.delete(key);
      }
    return;
  }
  if (!message.source || runs.has(id)) return;
  validateActionSource(message.source);
  const controller = new AbortController();
  runs.set(id, controller);
  let calls = 0;
  let annotationCalls = 1000;
  const ctx = Object.freeze({
    source: Object.freeze(message.source),
    signal: controller.signal,
    progress: (text: string) => {
      if (typeof text !== 'string' || text.length > 500)
        throw new Error('Progress must be at most 500 characters.');
      controller.signal.throwIfAborted();
      post({ id, event: { type: 'progress', text } });
    },
    annotations: (operation: unknown) => {
      controller.signal.throwIfAborted();
      const callId = ++annotationCalls;
      return new Promise<string>((resolve, reject) => {
        pending.set(id + ':' + callId, { resolve, reject });
        post({ id, event: { type: 'annotation', callId, operation } });
      }).then((text) => JSON.parse(text));
    },
    generate: (request: ActionGenerate) => {
      controller.signal.throwIfAborted();
      validateActionGenerate(request);
      const callId = ++calls;
      return new Promise<string>((resolve, reject) => {
        pending.set(id + ':' + callId, { resolve, reject });
        post({ id, event: { type: 'generate', callId, request } });
      });
    },
  });
  void Promise.resolve()
    .then(() => module.default(ctx))
    .then((text: unknown) => {
      controller.signal.throwIfAborted();
      if (typeof text !== 'string' || !text.trim() || text.length > ACTION_MAX_TEXT)
        throw new Error('The action must return nonempty text of at most 60,000 characters.');
      post({ id, event: { type: 'result', text } });
    })
    .catch((error: unknown) => {
      post({
        id,
        event: { type: 'error', message: error instanceof Error ? error.message : String(error) },
      });
    })
    .finally(() => runs.delete(id));
});
post({ ready: true });
