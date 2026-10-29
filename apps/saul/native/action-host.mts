#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { chatgptDirectory } from './installation-paths.mts';
import { encodeNative, nativeDecoder } from './transport.mts';
import { isRecord } from './value.mts';
import { ActionStore } from './action-store.mts';
import { ActionRuntime } from './action-runtime.mts';
import {
  ACTION_IDLE_MS,
  validateActionHostRequest,
  type ActionHostEvent,
} from './action-protocol.mts';

if (!/^chrome-extension:\/\/[a-p]{32}\/$/.test(process.argv[2] || '')) process.exit(1);
process.umask(0o077);
const store = new ActionStore(
  join(dirname(chatgptDirectory(import.meta.url)), 'actions', 'revisions'),
);
const runtime = new ActionRuntime(store);
const running = new Map<string, { controller: AbortController; revision?: string }>();
let idle: ReturnType<typeof setTimeout>;
const shutdown = () => {
  for (const r of running.values()) r.controller.abort();
  void runtime.close().finally(() => process.exit(0));
};
const resetIdle = () => {
  clearTimeout(idle);
  if (!running.size) idle = setTimeout(shutdown, ACTION_IDLE_MS);
};
const send = (id: string, event: ActionHostEvent) =>
  process.stdout.write(encodeNative({ id, event }));
const decode = nativeDecoder((message) => {
  if (!isRecord(message) || typeof message.id !== 'string' || message.id.length > 128)
    throw new Error('Invalid request ID.');
  const id = message.id;
  if (message.cancel === true) {
    running.get(id)?.controller.abort();
    return;
  }
  if (message.callId !== undefined) {
    const revision = running.get(id)?.revision;
    if (
      revision &&
      Number.isSafeInteger(message.callId) &&
      (typeof message.text === 'string' || typeof message.error === 'string')
    )
      void runtime.reply(revision, id, message.callId as number, {
        text: typeof message.text === 'string' ? message.text : undefined,
        error: typeof message.error === 'string' ? message.error : undefined,
      });
    return;
  }
  try {
    validateActionHostRequest(message.request);
  } catch (error) {
    send(id, { type: 'error', message: (error as Error).message });
    return;
  }
  if (running.has(id) || running.size >= 16) {
    send(id, { type: 'error', message: 'Action helper is busy.' });
    return;
  }
  const request = message.request;
  const controller = new AbortController();
  clearTimeout(idle);
  running.set(id, {
    controller,
    revision: request.action === 'run' ? request.revision : undefined,
  });
  void (async (): Promise<ActionHostEvent> => {
    switch (request.action) {
      case 'stage':
        return { type: 'result', revision: await store.stage(request.module) };
      case 'file':
        return { type: 'result', revision: await store.file(request.path) };
      case 'load':
        return { type: 'result', revision: await runtime.load(request.revision) };
      case 'prune':
        await runtime.prune(request.protect);
        return { type: 'result' };
      case 'run':
        return {
          type: 'result',
          text: await runtime.run(
            id,
            request.revision,
            request.source,
            (e) => send(id, e),
            controller.signal,
          ),
        };
    }
  })()
    .then(
      (event) => send(id, event),
      (error: unknown) =>
        send(id, {
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        }),
    )
    .finally(() => {
      running.delete(id);
      resetIdle();
    });
});
process.stdin.on('data', (chunk) => {
  try {
    decode(chunk);
  } catch {
    shutdown();
  }
});
process.stdin.on('end', shutdown);
process.stdin.on('error', shutdown);
process.stdout.on('error', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
resetIdle();
