#!/usr/bin/env node
import { isRecord } from './value.mts';
import type { PlanRequest, PlanEvent } from './plan-protocol.mts';
import { chatgptDirectory } from './installation-paths.mts';
import { encodeNative, nativeDecoder } from './transport.mts';
import { PlanStore } from './plan-store.mts';
import { PlanAuth } from './plan-auth.mts';
import { PlanService } from './plan-service.mts';
import { validatePlanRequest } from './plan-protocol.mts';

if (!/^chrome-extension:\/\/[a-p]{32}\/$/.test(process.argv[2] || '')) process.exit(1);
process.umask(0o077);
const service = new PlanService(new PlanAuth(new PlanStore(chatgptDirectory(import.meta.url))));
const running = new Map<string, { controller: AbortController; request: PlanRequest }>();
const send = (id: string, event: PlanEvent) => process.stdout.write(encodeNative({ id, event }));
const decode = nativeDecoder((message) => {
  if (!isRecord(message) || typeof message.id !== 'string' || message.id.length > 128)
    throw new Error('Invalid request ID');
  if (message.cancel === true) {
    running.get(message.id)?.controller.abort();
    return;
  }
  if (running.has(message.id) || running.size >= 16) {
    send(message.id, { type: 'error', message: 'ChatGPT helper is busy.' });
    return;
  }
  try {
    validatePlanRequest(message.request);
  } catch {
    send(message.id, { type: 'error', message: 'Invalid ChatGPT request.' });
    return;
  }
  if (
    message.request.action === 'login' &&
    [...running.values()].some((r) => r.request.action === 'login')
  ) {
    send(message.id, { type: 'error', message: 'A ChatGPT sign-in is already in progress.' });
    return;
  }
  if (message.request.action === 'logout') {
    for (const value of running.values())
      if ('accountId' in value.request && value.request.accountId === message.request.accountId)
        value.controller.abort();
  }
  const id = message.id;
  const controller = new AbortController();
  running.set(message.id, { controller, request: message.request });
  const timer = setTimeout(
    () => controller.abort(),
    message.request.action === 'login' ? 310_000 : 180_000,
  );
  void service
    .run(message.request, (event) => send(id, event), controller.signal)
    .catch((error) =>
      send(id, {
        type: 'error',
        message: controller.signal.aborted
          ? 'ChatGPT request stopped or timed out.'
          : error.message,
        reason: error.reason,
      }),
    )
    .finally(() => {
      clearTimeout(timer);
      running.delete(id);
    });
});
const shutdown = () => {
  for (const { controller } of running.values()) controller.abort();
  process.exit(0);
};
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
