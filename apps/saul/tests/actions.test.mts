import { mkdtemp, rm, writeFile, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ActionStore } from '../.build/native/action-store.mjs';
import { ActionRuntime } from '../.build/native/action-runtime.mjs';
import { checkAction } from '../.build/native/action-check.mjs';
import type { ActionModule } from '../native/action-protocol.mts';

const roots: string[] = [];
const runtimes: ActionRuntime[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
function module(
  source = 'export default async function run(ctx) { return "Answer: " + ctx.source.title; }',
): ActionModule {
  return {
    contractVersion: 1,
    name: 'Custom summary',
    description: 'Fixture',
    language: 'typescript',
    source,
  };
}
const source = {
  title: 'Article',
  url: 'https://example.com/',
  text: 'Captured text',
  coverage: 'Visible text',
};
async function fixture(timeout?: number) {
  const root = await mkdtemp(join(tmpdir(), 'saul-actions-'));
  roots.push(root);
  const store = new ActionStore(join(root, 'revisions'));
  const runtime = new ActionRuntime(store, timeout);
  runtimes.push(runtime);
  return { root, store, runtime };
}
it('stages without executing initialization or the handler, and checks syntax and supported imports', async () => {
  const f = await fixture();
  const candidate = await f.store.stage(
    module(
      'throw new Error("initialization executed"); export default function run() { return "answer"; }',
    ),
  );
  expect(candidate.approved).toBeUndefined();
  await expect(
    f.runtime.run('unapproved', candidate.revision, source, () => {}, new AbortController().signal),
  ).rejects.toThrow('not been loaded');
  await expect(f.runtime.load(candidate.revision)).rejects.toThrow('initialization executed');
  for (const code of [
    'import fs from "node:fs"; export default () => "x"',
    'export default async () => import("node:fs")',
    'export default () => process.env',
    'export default function ( {',
    'const x = 1;',
  ]) {
    expect(() => checkAction(module(code))).toThrow();
  }
});
it('loads without generation, validates actual exports, and reloads approved exact bytes after runtime loss', async () => {
  const f = await fixture();
  const candidate = await f.store.stage(module());
  const emit = vi.fn();
  await f.runtime.load(candidate.revision);
  expect(emit).not.toHaveBeenCalled();
  await expect(
    f.runtime.run('one', candidate.revision, source, emit, new AbortController().signal),
  ).resolves.toBe('Answer: Article');
  const invalid = await f.store.stage(module('export default 42;'));
  await expect(f.runtime.load(invalid.revision)).rejects.toThrow('default run');
  await expect(
    f.runtime.run('two', candidate.revision, source, emit, new AbortController().signal),
  ).resolves.toBe('Answer: Article');
  await f.runtime.close();
  const restarted = new ActionRuntime(f.store);
  runtimes.push(restarted);
  await expect(
    restarted.run('three', candidate.revision, source, emit, new AbortController().signal),
  ).resolves.toBe('Answer: Article');
  await writeFile(
    join(f.store.directory, candidate.revision + '.json'),
    JSON.stringify({ ...candidate, source: 'export default () => "changed";', approved: true }),
  );
  await expect(
    restarted.run('four', candidate.revision, source, emit, new AbortController().signal),
  ).rejects.toThrow('revision changed');
});
it('keeps active invocations on old code while a new revision becomes ready', async () => {
  const f = await fixture();
  const a = await f.store.stage(
    module('export default async ctx => "old " + await ctx.generate({instructions:"wait"});'),
  );
  const b = await f.store.stage(module('export default async ctx => "new " + ctx.source.title;'));
  await f.runtime.load(a.revision);
  let release: (() => Promise<void>) | undefined;
  const old = f.runtime.run(
    'old',
    a.revision,
    source,
    (event) => {
      if (event.type === 'generate')
        release = () => f.runtime.reply(a.revision, 'old', event.callId, { text: 'result' });
    },
    new AbortController().signal,
  );
  await vi.waitFor(() => expect(release).toBeDefined());
  await f.runtime.load(b.revision);
  await expect(
    f.runtime.run('new', b.revision, source, () => {}, new AbortController().signal),
  ).resolves.toBe('new Article');
  await release!();
  await expect(old).resolves.toBe('old result');
});
it('enforces the call budget even when the module catches errors', async () => {
  const f = await fixture();
  const candidate = await f.store.stage(
    module(
      'export default async ctx => { for(let i=0;i<4;i++) { try { await ctx.generate({instructions:"call"}); } catch {} } return "pretend success"; };',
    ),
  );
  await f.runtime.load(candidate.revision);
  let calls = 0;
  await expect(
    f.runtime.run(
      'budget',
      candidate.revision,
      source,
      (event) => {
        if (event.type === 'generate') {
          calls++;
          void f.runtime.reply(candidate.revision, 'budget', event.callId, { text: 'part' });
        }
      },
      new AbortController().signal,
    ),
  ).rejects.toThrow('three-model-call');
  expect(calls).toBe(3);
});
it('hard-stops synchronous loops on deadline and cancellation without replay', async () => {
  const f = await fixture(40);
  const candidate = await f.store.stage(module('export default async () => { while (true) {} };'));
  await f.runtime.load(candidate.revision);
  await expect(
    f.runtime.run('deadline', candidate.revision, source, () => {}, new AbortController().signal),
  ).rejects.toThrow('five-minute');
  await f.runtime.load(candidate.revision);
  const controller = new AbortController();
  const run = f.runtime.run('stop', candidate.revision, source, () => {}, controller.signal);
  const stopped = expect(run).rejects.toThrow('Stopped');
  setTimeout(() => controller.abort(), 10);
  await stopped;
});
it('checks local edits explicitly and prunes only old unreferenced revisions without following symlinks', async () => {
  const f = await fixture();
  let now = 0;
  const store = new ActionStore(f.store.directory, () => now);
  const path = join(f.root, 'summary.ts');
  await writeFile(path, module().source);
  const original = await store.file(path);
  await writeFile(path, 'export default () => "edited";');
  expect((await store.get(original.revision)).source).toBe(module().source);
  const edited = await store.file(path);
  const approved = await store.stage(module('export default () => "history";'));
  await store.approve(approved.revision);
  now = 8 * 86_400_000;
  await store.prune(new Set([original.revision, approved.revision]));
  await expect(store.get(edited.revision)).rejects.toThrow('ENOENT');
  expect((await store.get(approved.revision)).approved).toBe(true);
  await symlink(path, join(f.root, 'link.ts'));
  await expect(store.file(join(f.root, 'link.ts'))).rejects.toThrow('regular file');
  expect(await readFile(path, 'utf8')).toContain('edited');
});

it('shutdown rejects pending initialization and cannot spawn a late worker after closure', async () => {
  const f = await fixture();
  const candidate = await f.store.stage(module('while (true) {} export default () => "never";'));
  const loading = expect(f.runtime.load(candidate.revision)).rejects.toThrow(/closed|disconnected/);
  await f.runtime.close();
  await loading;
  await expect(f.runtime.load(candidate.revision)).rejects.toThrow('closed');
  expect((await f.store.get(candidate.revision)).approved).toBeUndefined();
});
