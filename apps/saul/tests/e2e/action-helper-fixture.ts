import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Worker } from '@playwright/test';
import { installHelpers } from '../../.build/native/installation.mjs';
import { encodeNative, nativeDecoder } from '../../native/transport.mts';
import type { FixtureServer } from './support';

// The real installed helper, workers and store; only Chrome's OS registration transport is replaced.
export async function actionHelperFixture(server: FixtureServer) {
  const root = await mkdtemp(join(tmpdir(), 'saul-action-browser-'));
  const installDir = join(root, 'installed');
  await installHelpers({
    components: ['actions'],
    extensionId: 'a'.repeat(32),
    installDir,
    manifestDir: join(root, 'manifests'),
  });
  const children = new Map<string, ChildProcessWithoutNullStreams>();
  const messages: unknown[] = [];
  server.setHandler('/action-events', (req, res) => {
    const url = new URL(req.url!, server.origin);
    const connection = url.searchParams.get('connection')!;
    const extension = url.searchParams.get('extension')!;
    if (!/^[a-p]{32}$/.test(extension)) {
      res.writeHead(400).end();
      return;
    }
    const child = spawn(
      join(installDir, 'bin/saul-action-host'),
      [`chrome-extension://${extension}/`],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    children.set(connection, child);
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.flushHeaders();
    const decode = nativeDecoder((message) => res.write(JSON.stringify(message) + '\n'));
    child.stdout.on('data', (chunk: Buffer) => decode(chunk));
    child.stderr.resume();
    child.on('exit', () => {
      children.delete(connection);
      res.end();
    });
    res.on('close', () => child.stdin.end());
  });
  server.setHandler('/action-send', (req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      const { connection, message } = JSON.parse(body);
      messages.push(message);
      children.get(connection)?.stdin.write(encodeNative(message));
      res.end('ok');
    });
  });
  return {
    messages,
    kill: () => {
      for (const child of children.values()) child.kill('SIGTERM');
    },
    install: (worker: Worker) =>
      worker.evaluate((origin) => {
        const original = chrome.runtime.connectNative.bind(chrome.runtime);
        chrome.runtime.connectNative = ((host: string) => {
          if (host !== 'com.saul.actions') return original(host);
          const connection = crypto.randomUUID();
          const listeners: ((message: unknown) => void)[] = [];
          const disconnects: (() => void)[] = [];
          const controller = new AbortController();
          const ready = fetch(
            `${origin}/action-events?connection=${connection}&extension=${chrome.runtime.id}`,
            { signal: controller.signal },
          );
          void ready
            .then(async (response) => {
              const reader = response.body!.getReader();
              const decoder = new TextDecoder();
              let buffer = '';
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let newline: number;
                while ((newline = buffer.indexOf('\n')) >= 0) {
                  const message: unknown = JSON.parse(buffer.slice(0, newline));
                  buffer = buffer.slice(newline + 1);
                  listeners.forEach((fn) => fn(message));
                }
              }
            })
            .catch(() => {})
            .finally(() => disconnects.forEach((fn) => fn()));
          return {
            onMessage: { addListener: (fn: (message: unknown) => void) => listeners.push(fn) },
            onDisconnect: { addListener: (fn: () => void) => disconnects.push(fn) },
            postMessage: (message: unknown) => {
              void ready
                .then(() =>
                  fetch(origin + '/action-send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ connection, message }),
                  }),
                )
                .catch(() => {});
            },
            disconnect: () => controller.abort(),
          } as unknown as chrome.runtime.Port;
        }) as typeof chrome.runtime.connectNative;
      }, server.origin),
    close: async () => {
      for (const child of children.values()) child.kill('SIGTERM');
      await rm(root, { recursive: true, force: true });
    },
  };
}
