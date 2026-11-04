import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
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
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
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
  // Test-only clock injection observes the real installed host's scheduling policy.
  // Workers retain real clocks; no production environment override is needed.
  const clock = join(dir, 'idle-clock.mjs');
  await writeFile(
    clock,
    `import { isMainThread } from 'node:worker_threads';
if (isMainThread) {
  const schedule = globalThis.setTimeout;
  globalThis.setTimeout = (callback, milliseconds, ...args) => {
    process.stderr.write('idle-clock:' + milliseconds + '\\n');
    return schedule(callback, milliseconds === 60000 ? 200 : milliseconds, ...args);
  };
}
`,
  );
  return { ...options, clock };
}
function connect(root: string, clock?: string, env: NodeJS.ProcessEnv = process.env) {
  env = { ...env };
  if (clock) env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} --import=${pathToFileURL(clock).href}`;
  const child = spawn(
    join(root, 'bin/saul-action-host'),
    [`chrome-extension://${'a'.repeat(32)}/`],
    { env, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  children.push(child);
  const clockDelays: number[] = [];
  const stderr = createInterface({ input: child.stderr });
  stderr.on('line', (line) => {
    if (line.startsWith('idle-clock:')) clockDelays.push(Number(line.slice('idle-clock:'.length)));
  });
  const events: { id: string; event: ActionHostEvent }[] = [];
  const waiting = new Map<string, (event: ActionHostEvent) => void>();
  const decode = nativeDecoder((value) => {
    const message = value as { id: string; event: ActionHostEvent };
    events.push(message);
    if (message.event.type === 'generate') child.emit('action-generate', message);
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
    clockDelays,
    cancel: (id: string) => child.stdin.write(encodeNative({ id, cancel: true })),
    reply: (id: string, callId: number, text: string) =>
      child.stdin.write(encodeNative({ id, callId, text })),
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
it('exits after idle timeout and reloads approved code on the next deliberate connection', async () => {
  const options = await install();
  const host = connect(options.installDir, options.clock);
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
  const [code] = await once(host.child, 'exit');
  expect(code).toBe(0);
  expect(
    host.clockDelays.filter((milliseconds) => milliseconds === 60_000).length,
  ).toBeGreaterThanOrEqual(3);
  const restored = connect(options.installDir);
  expect(
    await restored.call({
      action: 'run',
      revision: staged.revision.revision,
      source: { title: 'Page', url: 'https://example.com/', coverage: 'Visible' },
    }),
  ).toEqual({ type: 'result', text: 'restored' });
  expect(host.events.filter((e) => e.event.type === 'generate')).toHaveLength(0);
}, 10_000);

it('keeps the installed sixty-second idle policy regardless of former environment overrides', async () => {
  const options = await install();
  for (const value of [undefined, '-1', '0', 'Infinity', '1.5', '2147483648', '200']) {
    const env = { ...process.env };
    if (value === undefined) delete env.SAUL_ACTION_IDLE_MS;
    else env.SAUL_ACTION_IDLE_MS = value;
    const host = connect(options.installDir, options.clock, env);
    const [code] = await once(host.child, 'exit');
    expect(code).toBe(0);
    expect(host.clockDelays).toEqual([60_000]);
    expect(host.events).toEqual([]);
  }
}, 10_000);

it('keeps active work alive past idle expiry, then cancels once and exits without replay', async () => {
  const options = await install();
  const host = connect(options.installDir, options.clock);
  const staged = await host.call({
    action: 'stage',
    module: {
      contractVersion: 1,
      name: 'Held generation',
      description: '',
      language: 'javascript',
      source: 'export default async ctx => await ctx.generate({ instructions: "Hold this call" });',
    },
  });
  if (staged.type !== 'result' || !staged.revision) throw new Error(JSON.stringify(staged));
  expect(await host.call({ action: 'load', revision: staged.revision.revision })).toMatchObject({
    type: 'result',
  });
  const generated = once(host.child, 'action-generate');
  const result = host.call({
    action: 'run',
    revision: staged.revision.revision,
    source: { title: 'Held', url: 'https://example.com/', coverage: 'Visible' },
  });
  const [message] = (await generated) as [
    { id: string; event: ActionHostEvent & { callId: number } },
  ];
  await delay(250);
  expect(host.child.exitCode).toBeNull();
  expect(
    host.events.filter((event) => event.id === message.id && event.event.type === 'result'),
  ).toEqual([]);
  const exited = once(host.child, 'exit');
  host.cancel(message.id);
  expect(await result).toEqual({
    type: 'error',
    message: 'Stopped. Outstanding model calls were cancelled; no work was replayed.',
  });
  host.reply(message.id, message.event.callId, 'late reply');
  expect((await exited)[0]).toBe(0);
  expect(host.events.filter((event) => event.event.type === 'generate')).toHaveLength(1);
  expect(
    host.events.filter(
      (event) => event.id === message.id && ['result', 'error'].includes(event.event.type),
    ),
  ).toHaveLength(1);
}, 10_000);
