import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, expect, it } from 'vitest';
import {
  installHelpers,
  verifyInstallation,
  restoreGeneration,
} from '../.build/native/installation.mjs';
import { encodeNative, nativeDecoder } from '../native/transport.mts';
import type { ActionHostEvent, ActionHostRequest } from '../native/action-protocol.mts';

const roots: string[] = [];
const children: ChildProcessWithoutNullStreams[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function install(components = ['actions']) {
  const dir = await mkdtemp(join(tmpdir(), 'saul-action-host-'));
  roots.push(dir);
  const options = {
    components,
    extensionId: 'a'.repeat(32),
    installDir: join(dir, 'installed'),
    manifestDir: join(dir, 'manifests'),
  };
  await installHelpers(options);
  return options;
}
function connect(root: string) {
  const child = spawn(
    join(root, 'bin/saul-action-host'),
    [`chrome-extension://${'a'.repeat(32)}/`],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  children.push(child);
  child.stderr.resume();
  const events: { id: string; event: ActionHostEvent }[] = [];
  const waiting = new Map<string, (event: ActionHostEvent) => void>();
  const decode = nativeDecoder((value) => {
    const message = value as { id: string; event: ActionHostEvent };
    events.push(message);
    if (message.event.type === 'result' || message.event.type === 'error') {
      waiting.get(message.id)?.(message.event);
      waiting.delete(message.id);
    }
  });
  child.stdout.on('data', (chunk: Buffer) => decode(chunk));
  let next = 0;
  return {
    child,
    events,
    call: (request: ActionHostRequest) =>
      new Promise<ActionHostEvent>((resolve) => {
        const id = String(++next);
        waiting.set(id, resolve);
        child.stdin.write(encodeNative({ id, request }));
      }),
  };
}
it('coexists with both existing hosts, preserves their payloads and supports retained-generation restoration', async () => {
  const options = await install(['tabs', 'chatgpt']);
  const previous = verifyInstallation(options.installDir, 'chatgpt');
  if (previous.legacy) throw new Error('Expected managed generation.');
  const before = await readFile(join(options.installDir, 'bridge/chatgpt/plan-host.mjs'));
  await installHelpers({ ...options, components: ['actions'] });
  expect(await readFile(join(options.installDir, 'bridge/chatgpt/plan-host.mjs'))).toEqual(before);
  expect(verifyInstallation(options.installDir, 'tabs').generation).not.toBe(previous.generation);
  const host = connect(options.installDir);
  const staged = await host.call({
    action: 'stage',
    module: {
      contractVersion: 1,
      name: 'Installed',
      description: '',
      language: 'typescript',
      source: 'export default async ctx => ctx.source.title;',
    },
  });
  if (staged.type !== 'result' || !staged.revision) throw new Error(JSON.stringify(staged));
  expect(await host.call({ action: 'load', revision: staged.revision.revision })).toMatchObject({
    type: 'result',
    revision: { approved: true },
  });
  expect(
    await host.call({
      action: 'run',
      revision: staged.revision.revision,
      source: {
        title: 'Installed answer',
        url: 'https://example.com/',
        text: 'Source',
        coverage: 'Visible',
      },
    }),
  ).toEqual({ type: 'result', text: 'Installed answer' });
  restoreGeneration(options.installDir, previous.generation);
  expect(() => verifyInstallation(options.installDir, 'actions')).toThrow('not installed');
  // The already running host retains its generation and approved data after installer rollback.
  expect(
    await host.call({
      action: 'run',
      revision: staged.revision.revision,
      source: { title: 'Retained process', url: 'https://example.com/', coverage: 'Visible' },
    }),
  ).toEqual({ type: 'result', text: 'Retained process' });
}, 20_000);
it('exits after sixty idle seconds and reloads approved code on the next deliberate connection', async () => {
  const options = await install();
  const host = connect(options.installDir);
  const staged = await host.call({
    action: 'stage',
    module: {
      contractVersion: 1,
      name: 'Idle',
      description: '',
      language: 'javascript',
      source: 'export default () => "restored";',
    },
  });
  if (staged.type !== 'result' || !staged.revision) throw new Error(JSON.stringify(staged));
  await host.call({ action: 'load', revision: staged.revision.revision });
  const before = Date.now();
  const [code] = await once(host.child, 'exit');
  expect(code).toBe(0);
  expect(Date.now() - before).toBeGreaterThanOrEqual(59_000);
  const restored = connect(options.installDir);
  expect(
    await restored.call({
      action: 'run',
      revision: staged.revision.revision,
      source: { title: 'Page', url: 'https://example.com/', coverage: 'Visible' },
    }),
  ).toEqual({ type: 'result', text: 'restored' });
  expect(host.events.filter((e) => e.event.type === 'generate')).toHaveLength(0);
}, 75_000);
