#!/usr/bin/env node
import { Fragments, packets } from '../../shared/protocol/fragments.mts';
import { isRecord } from '../../shared/model/value.mts';
import type { StorageEvent } from '../../shared/protocol/storage-protocol.mts';
import { encodeNative, nativeDecoder } from '../transport.mts';
import { HistoryConfigService } from '../storage/service.mts';
import { validateStorageHelperRequest } from '../../shared/protocol/storage-protocol.mts';

if (!/^chrome-extension:\/\/[a-p]{32}\/$/.test(process.argv[2] || '')) process.exit(1);
process.umask(0o077);
const service = new HistoryConfigService();
const running = new Map<string, AbortController>();
const send = (id: string, event: StorageEvent) => {
  for (const packet of packets({ id, event })) process.stdout.write(encodeNative(packet));
};
const fragments = new Fragments();
const decode = nativeDecoder((packet) => {
  const message = fragments.accept(packet);
  if (message === undefined) return;
  if (!isRecord(message) || typeof message.id !== 'string' || message.id.length > 128)
    throw new Error('Invalid request ID');
  if (message.cancel === true) {
    running.get(message.id)?.abort();
    return;
  }
  if (running.has(message.id) || running.size >= 16) {
    send(message.id, { type: 'error', message: 'Saul history/configuration helper is busy.' });
    return;
  }
  try {
    validateStorageHelperRequest(message.request);
  } catch (error) {
    send(message.id, {
      type: 'error',
      message: error instanceof Error ? error.message : 'Invalid history/configuration request.',
    });
    return;
  }
  const id = message.id;
  const controller = new AbortController();
  running.set(id, controller);
  const timer = setTimeout(() => controller.abort(), 180_000);
  void service
    .run(message.request, (event) => {
      if (!controller.signal.aborted) send(id, event);
    })
    .catch((error: unknown) => {
      if (!controller.signal.aborted)
        send(id, {
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
    })
    .finally(() => {
      clearTimeout(timer);
      running.delete(id);
    });
});
const shutdown = () => {
  service.close();
  for (const controller of running.values()) controller.abort();
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
