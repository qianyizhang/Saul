import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPlan, executePlan, installExtension } from '../scripts/setup.mjs';

const environment = {
  repo: '/fixture/repo',
  home: '/fixture/home',
  platform: 'darwin',
  node: '/fixture/node',
};
const id = 'a'.repeat(32);

test('extension, helpers and native app are independently selectable; Codex is explicit', () => {
  const extension = createPlan({ components: 'extension' }, environment);
  assert.deepEqual(extension.components, ['extension']);
  assert.deepEqual(
    extension.commands.map((c) => c.command),
    ['pnpm', 'pnpm'],
  );
  assert.equal(extension.hosts.length, 0);
  const native = createPlan({ components: 'ez' }, environment);
  assert.deepEqual(
    native.commands.map((c) => c.command),
    ['make'],
  );
  assert.equal(native.commands[0].env.EZ_APPLICATIONS_DIR, '/fixture/home/Applications');
  const helpers = createPlan(
    { components: 'chatgpt,tabs', extensionId: id, skipBuild: true },
    environment,
  );
  assert.equal(helpers.commands.length, 2);
  assert.equal(helpers.hosts[0].manifest.name, 'com.saul.chatgpt');
  assert.equal(helpers.hosts[1].manifest.name, 'com.saul.tabs');
  assert(!helpers.commands.some((c) => c.command === 'codex'));
  const connected = createPlan({ components: 'tabs', extensionId: id, codex: true }, environment);
  assert.equal(connected.commands.at(-1).command, 'codex');
});

test('unsupported combinations and missing helper identity fail before execution', () => {
  for (const options of [
    { components: 'unknown' },
    { components: 'tabs' },
    { components: 'extension', codex: true },
    { components: 'ez', skipBuild: true },
    { components: 'extension', prepare: true, verify: true },
    { components: 'extension', extensionDir: '/fixture/home' },
  ])
    assert.throws(() => createPlan(options, environment));
  assert.throws(() => createPlan({ components: 'ez' }, { ...environment, platform: 'linux' }));
  assert.doesNotThrow(() =>
    createPlan({ components: 'extension' }, { ...environment, platform: 'linux' }),
  );
});

test('prepare builds without installing or registering; verification has no install commands', () => {
  const plan = createPlan({ components: 'extension,chatgpt,tabs,ez', prepare: true }, environment);
  assert.deepEqual(
    plan.commands.map((c) => [c.command, c.args[0]]),
    [
      ['pnpm', 'install'],
      ['pnpm', 'build'],
      ['make', 'app'],
    ],
  );
  assert.equal(
    createPlan({ components: 'extension,ez', verify: true }, environment).commands.length,
    0,
  );
});

test('extension copy retains bytes, verifies artifact, and refuses to replace existing data or symlinks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workspace-install-'));
  try {
    const source = join(dir, 'source');
    const target = join(dir, 'installed');
    await mkdir(source);
    await writeFile(join(source, 'manifest.json'), JSON.stringify({ manifest_version: 3 }));
    await writeFile(join(source, 'payload'), 'fixture');
    await installExtension(source, target);
    assert.equal(await readFile(join(target, 'payload'), 'utf8'), 'fixture');
    await assert.rejects(installExtension(source, target), /already exists/);
    const alias = join(dir, 'alias');
    await symlink(target, alias);
    await assert.rejects(installExtension(source, alias), /already exists/);
    const plan = createPlan(
      { components: 'extension', extensionDir: target, verify: true },
      { ...environment, home: join(dir, 'home') },
    );
    await executePlan(plan, {
      log() {},
      run() {
        throw new Error('Verification must not execute installers');
      },
    });
    await writeFile(join(source, 'manifest.json'), '{}');
    await assert.rejects(installExtension(source, join(dir, 'bad')), /not a Chrome MV3/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('missing prerequisites and an existing Codex registration stop before installation', async () => {
  const plan = createPlan(
    { components: 'tabs', extensionId: id, skipBuild: true, codex: true },
    environment,
  );
  const calls = [];
  await assert.rejects(
    executePlan(plan, {
      log() {},
      run: async (command, args) => {
        calls.push([command, args]);
        return command === '/fixture/node' ? 'v24.21.0' : '[{"name":"saul-tabs"}]';
      },
    }),
    /already registered/,
  );
  assert.equal(calls.length, 2);
  await assert.rejects(executePlan(plan, { log() {}, run: async () => 'v25.0.0' }), /Use Node 24/);
});

test('helper registration verification rejects mismatched extension identity without executing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workspace-host-'));
  try {
    const plan = createPlan(
      {
        components: 'chatgpt',
        extensionId: id,
        verify: true,
        installDir: join(dir, 'runtime'),
        manifestDir: dir,
      },
      environment,
    );
    await writeFile(
      plan.hosts[0].manifestPath,
      JSON.stringify({ ...plan.hosts[0].manifest, allowed_origins: [] }),
    );
    await assert.rejects(
      executePlan(plan, {
        log() {},
        run() {
          throw new Error('Must not run');
        },
      }),
      /registration mismatch/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an existing extension destination stops the whole install before other components change', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workspace-existing-'));
  try {
    const plan = createPlan(
      { components: 'extension,chatgpt,ez', extensionId: id, extensionDir: dir },
      environment,
    );
    await assert.rejects(
      executePlan(plan, {
        log() {},
        run() {
          throw new Error('No command should run before destination validation');
        },
      }),
      /destination already exists/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
