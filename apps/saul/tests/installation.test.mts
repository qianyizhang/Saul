import type { Component } from '../native/installation.mts';
import * as fs from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir, hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, expect, it } from 'vitest';
import { chatgptDirectory } from '../native/installation-paths.mts';
import {
  installHelpers,
  installationPlan,
  payloadFiles,
  restoreGeneration,
  verifyInstallation,
} from '../.build/native/installation.mjs';

const roots: string[] = [];
const source = fileURLToPath(new URL('../.build/native/', import.meta.url));
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const dir = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'saul-installation-')));
  roots.push(dir);
  const native = join(dir, 'source'),
    root = join(dir, 'installed'),
    manifests = join(dir, 'manifests');
  fs.mkdirSync(native);
  for (const file of new Set(Object.values(payloadFiles).flat())) {
    const path = join(native, file);
    fs.mkdirSync(dirname(path), { recursive: true });
    fs.writeFileSync(path, file.endsWith('.mjs') ? 'export {};\n' : 'fixture-v1');
  }
  for (const file of ['installation-paths.mjs', 'value.mjs'])
    fs.copyFileSync(join(source, file), join(native, file));
  fs.writeFileSync(
    join(native, 'plan-host.mjs'),
    "import { chatgptDirectory } from './installation-paths.mjs'; console.log(chatgptDirectory(import.meta.url));\n",
  );
  fs.writeFileSync(join(native, 'cli.mjs'), "console.log('tabs-v1');\n");
  fs.writeFileSync(
    join(native, 'mcp.mjs'),
    `import {readFileSync} from 'node:fs';
process.stdin.setEncoding('utf8');
process.stdin.on('data', () => console.log(readFileSync(new URL('./ui/workspace.html', import.meta.url), 'utf8')));
console.log('ready');\n`,
  );
  const jose = join(dir, 'jose');
  fs.mkdirSync(jose);
  fs.writeFileSync(join(jose, 'package.json'), '{"name":"jose","version":"0.0.0","type":"module"}');
  fs.writeFileSync(join(jose, 'index.js'), 'export {};');
  return {
    dir,
    native,
    root,
    manifests,
    options: { extensionId: 'a'.repeat(32), installDir: root, manifestDir: manifests },
    dependencies: { source: native, jose, environment: {}, verify: async () => {} },
  };
}
function selected(f: ReturnType<typeof fixture>, component: Component = 'tabs') {
  const value = verifyInstallation(f.root, component);
  if (value.legacy) throw new Error('Expected managed fixture');
  return value;
}
function manifest(f: ReturnType<typeof fixture>, component: Component = 'tabs') {
  return join(f.manifests, component === 'tabs' ? 'com.saul.tabs.json' : 'com.saul.chatgpt.json');
}
function command(f: ReturnType<typeof fixture>, name: string) {
  return execFileSync(join(f.root, 'bin', name), [], { encoding: 'utf8' }).trim();
}

it('installs complete generations through stable entry paths and keeps credentials outside payloads', async () => {
  const f = fixture();
  fs.mkdirSync(join(f.root, 'chatgpt'), { recursive: true });
  fs.writeFileSync(join(f.root, 'chatgpt', 'accounts.json'), 'PRIVATE-FIXTURE-CREDENTIALS');
  await installHelpers({ ...f.options, components: ['tabs', 'chatgpt'] }, f.dependencies);
  expect(fs.readlinkSync(join(f.root, 'bin'))).toBe('bridge/bin');
  expect(fs.readlinkSync(join(f.root, 'bridge'))).toMatch(/^generations\/g-/);
  expect(command(f, 'saul')).toBe('tabs-v1');
  expect(command(f, 'saul-chatgpt-host')).toBe(join(f.root, 'chatgpt'));
  const value = selected(f, 'chatgpt');
  expect(fs.readFileSync(join(f.root, 'chatgpt', 'accounts.json'), 'utf8')).toBe(
    'PRIVATE-FIXTURE-CREDENTIALS',
  );
  const receipt = JSON.parse(
    fs.readFileSync(join(f.root, 'generations', value.generation, 'installation.json'), 'utf8'),
  );
  expect(Object.keys(receipt.files).some((file) => file.includes('accounts'))).toBe(false);
  expect(fs.statSync(join(f.root, 'bin', 'saul')).mode & 0o777).toBe(0o700);
});

it('an installed helper rejects missing data-root metadata instead of opening a new credential store', async () => {
  const f = fixture();
  await installHelpers({ ...f.options, components: ['chatgpt'] }, f.dependencies);
  const payload = join(f.root, 'generations', selected(f, 'chatgpt').generation, 'chatgpt');
  fs.unlinkSync(join(payload, 'installation-root.json'));
  expect(() => chatgptDirectory(new URL(`file://${join(payload, 'plan-host.mjs')}`))).toThrow(
    'Invalid helper installation data root',
  );
});

it('a late missing file leaves the active generation and registration unchanged', async () => {
  const f = fixture();
  await installHelpers(f.options, f.dependencies);
  const before = selected(f),
    registered = fs.readFileSync(manifest(f));
  fs.writeFileSync(join(f.native, 'protocol.mjs'), 'export const changed = true;\n');
  fs.unlinkSync(join(f.native, 'ui/workspace.bundle.js'));
  await expect(installHelpers(f.options, f.dependencies)).rejects.toThrow('ENOENT');
  expect(selected(f).generation).toBe(before.generation);
  expect(fs.readFileSync(manifest(f))).toEqual(registered);
  expect(command(f, 'saul')).toBe('tabs-v1');
});

it('activation failure restores registrations and leaves the prior runtime runnable', async () => {
  const f = fixture();
  await installHelpers(f.options, f.dependencies);
  const before = selected(f),
    registered = fs.readFileSync(manifest(f));
  const io = {
    ...fs,
    renameSync(from: fs.PathLike, to: fs.PathLike) {
      if (to === join(f.root, 'bridge')) throw new Error('Synthetic activation failure');
      return fs.renameSync(from, to);
    },
  };
  fs.writeFileSync(join(f.native, 'cli.mjs'), "console.log('tabs-v2');\n");
  await expect(
    installHelpers(
      { ...f.options, extensionId: 'b'.repeat(32) },
      { ...f.dependencies, filesystem: io },
    ),
  ).rejects.toThrow('Synthetic activation failure');
  expect(selected(f).generation).toBe(before.generation);
  expect(fs.readFileSync(manifest(f))).toEqual(registered);
  expect(command(f, 'saul')).toBe('tabs-v1');
  expect(fs.existsSync(join(f.root, '.install-transaction.json'))).toBe(false);
});

it('serializes simultaneous installer transactions instead of replacing an active writer', async () => {
  const f = fixture();
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = installHelpers(f.options, {
    ...f.dependencies,
    verify: async () => {
      entered();
      await held;
    },
  });
  await waiting;
  try {
    await expect(installHelpers(f.options, f.dependencies)).rejects.toThrow(
      'Another helper installation',
    );
  } finally {
    release();
  }
  await first;
  expect(command(f, 'saul')).toBe('tabs-v1');
});

it('updating one helper preserves the other payload, Node choice, proxy and registration', async () => {
  const f = fixture();
  await installHelpers(
    { ...f.options, components: ['tabs', 'chatgpt'] },
    { ...f.dependencies, environment: { HTTPS_PROXY: 'http://fixture-proxy.invalid:1234' } },
  );
  const before = selected(f, 'chatgpt');
  const registered = fs.readFileSync(manifest(f, 'chatgpt'));
  const oldReceipt = JSON.parse(
    fs.readFileSync(join(f.root, 'generations', before.generation, 'installation.json'), 'utf8'),
  );
  fs.writeFileSync(join(f.native, 'cli.mjs'), "console.log('tabs-v2');\n");
  fs.writeFileSync(
    join(f.native, 'plan-host.mjs'),
    "throw new Error('must not update unselected helper');\n",
  );
  await installHelpers(f.options, f.dependencies);
  const after = selected(f, 'chatgpt');
  const newReceipt = JSON.parse(
    fs.readFileSync(join(f.root, 'generations', after.generation, 'installation.json'), 'utf8'),
  );
  expect(after.helper).toEqual(before.helper);
  expect(fs.readFileSync(manifest(f, 'chatgpt'))).toEqual(registered);
  expect(
    Object.fromEntries(
      Object.entries(newReceipt.files).filter(([name]) => name.startsWith('chatgpt/')),
    ),
  ).toEqual(
    Object.fromEntries(
      Object.entries(oldReceipt.files).filter(([name]) => name.startsWith('chatgpt/')),
    ),
  );
  expect(command(f, 'saul')).toBe('tabs-v2');
  expect(command(f, 'saul-chatgpt-host')).toBe(join(f.root, 'chatgpt'));
});

function childLines(path: string) {
  const child = spawn(process.execPath, [path], { stdio: ['pipe', 'pipe', 'pipe'] });
  const buffered: string[] = [],
    waiting: { resolve: (line: string) => void; reject: (error: unknown) => void }[] = [];
  let pending = '',
    errors = '';
  child.stderr.on('data', (data) => {
    errors += data;
  });
  child.stdout.on('data', (data) => {
    pending += data;
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      if (waiting.length) waiting.shift()!.resolve(line);
      else buffered.push(line);
    }
  });
  child.on('error', (error) => {
    for (const item of waiting.splice(0)) item.reject(error);
  });
  child.on('exit', (code) => {
    for (const item of waiting.splice(0))
      item.reject(new Error(`Fixture exited ${code}: ${errors}`));
  });
  return {
    child,
    line: () =>
      buffered.length
        ? Promise.resolve(buffered.shift())
        : new Promise<string>((resolve, reject) => {
            waiting.push({ resolve, reject });
          }),
    close: async () => {
      const ended = once(child, 'exit');
      child.stdin.end();
      await ended;
    },
  };
}
it('running processes keep old lazy assets while new connections select the new generation', async () => {
  const f = fixture();
  await installHelpers(f.options, f.dependencies);
  const old = childLines(join(f.root, 'bridge', 'mcp.mjs'));
  let newer;
  try {
    expect(await old.line()).toBe('ready');
    fs.writeFileSync(join(f.native, 'ui/workspace.html'), 'fixture-v2');
    await installHelpers(f.options, f.dependencies);
    newer = childLines(join(f.root, 'bridge', 'mcp.mjs'));
    expect(await newer.line()).toBe('ready');
    old.child.stdin.write('read\n');
    newer.child.stdin.write('read\n');
    expect(await old.line()).toBe('fixture-v1');
    expect(await newer.line()).toBe('fixture-v2');
  } finally {
    await old.close();
    if (newer) await newer.close();
  }
});

function legacy(f: ReturnType<typeof fixture>, components = ['tabs']) {
  fs.mkdirSync(join(f.root, 'bridge'), { recursive: true });
  fs.mkdirSync(join(f.root, 'bin'));
  fs.mkdirSync(f.manifests);
  for (const component of components) {
    for (const file of payloadFiles[component]) {
      const target = join(f.root, 'bridge', file);
      fs.mkdirSync(dirname(target), { recursive: true });
      fs.copyFileSync(join(f.native, file), target);
    }
    const plan = installationPlan({ ...f.options, chatgpt: component === 'chatgpt' });
    fs.writeFileSync(plan.manifest.path, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    fs.writeFileSync(plan.manifestPath, JSON.stringify(plan.manifest));
  }
}
it('legacy verification stays read-only and reports its integrity limitation', () => {
  const f = fixture();
  legacy(f);
  const before = fs.readFileSync(manifest(f));
  expect(verifyInstallation(f.root, 'tabs')).toEqual({
    legacy: true,
    generation: null,
    previous: null,
  });
  expect(fs.lstatSync(join(f.root, 'bridge')).isDirectory()).toBe(true);
  expect(fs.readFileSync(manifest(f))).toEqual(before);
  expect(fs.existsSync(join(f.root, 'generations'))).toBe(false);
  expect(() => verifyInstallation(f.root, 'chatgpt')).toThrow();
});

it('legacy migration requires all installed helpers and an explicit disconnected maintenance window', async () => {
  const f = fixture();
  legacy(f, ['tabs', 'chatgpt']);
  await expect(installHelpers(f.options, f.dependencies)).rejects.toThrow(
    'select all installed helpers',
  );
  const both = { ...f.options, components: ['tabs', 'chatgpt'] };
  await expect(installHelpers(both, f.dependencies)).rejects.toThrow('maintenance window');
  await expect(
    installHelpers(
      { ...both, migrateLegacy: true },
      { ...f.dependencies, inspectLegacyProcesses: () => 1 },
    ),
  ).rejects.toThrow('still active');
  await expect(
    installHelpers(
      { ...both, migrateLegacy: true },
      { ...f.dependencies, inspectLegacyProcesses: () => Number.NaN },
    ),
  ).rejects.toThrow('activity is uncertain');
  expect(fs.lstatSync(join(f.root, 'bridge')).isDirectory()).toBe(true);
  const result = await installHelpers(
    { ...both, migrateLegacy: true },
    { ...f.dependencies, inspectLegacyProcesses: () => 0 },
  );
  expect(fs.existsSync(join(f.root, result.legacyBackup!, 'bridge', 'plan-host.mjs'))).toBe(true);
  expect(command(f, 'saul-chatgpt-host')).toBe(join(f.root, 'chatgpt'));
});

it('recovers an interrupted transaction before starting another and never selects partial bytes', async () => {
  const f = fixture();
  await installHelpers(f.options, f.dependencies);
  const before = selected(f),
    registered = fs.readFileSync(manifest(f));
  const script = join(f.dir, 'interrupted.mjs');
  fs.writeFileSync(
    script,
    `import * as fs from 'node:fs';
import {installHelpers} from ${JSON.stringify(new URL('../.build/native/installation.mjs', import.meta.url).href)};
const options=${JSON.stringify({ ...f.options, extensionId: 'b'.repeat(32) })};
const io={...fs, renameSync(from,to) { fs.renameSync(from,to); if(to===${JSON.stringify(manifest(f))}) process.exit(78); }};
await installHelpers(options,{source:${JSON.stringify(f.native)}, jose:${JSON.stringify(f.dependencies.jose)}, environment:{}, verify:async()=>{}, filesystem:io});`,
  );
  const child = spawn(process.execPath, [script], { stdio: 'pipe' });
  expect((await once(child, 'exit'))[0]).toBe(78);
  expect(fs.existsSync(join(f.root, '.install-transaction.json'))).toBe(true);
  fs.unlinkSync(join(f.native, 'cli.mjs'));
  await expect(installHelpers(f.options, f.dependencies)).rejects.toThrow('ENOENT');
  expect(selected(f).generation).toBe(before.generation);
  expect(fs.readFileSync(manifest(f))).toEqual(registered);
  expect(command(f, 'saul')).toBe('tabs-v1');
});

it('recovery retains a complete generation committed before an interruption', async () => {
  const f = fixture();
  await installHelpers(f.options, f.dependencies);
  const before = selected(f);
  fs.writeFileSync(join(f.native, 'cli.mjs'), "console.log('tabs-v2');\n");
  const script = join(f.dir, 'committed.mjs');
  fs.writeFileSync(
    script,
    `import * as fs from 'node:fs';
import {installHelpers} from ${JSON.stringify(new URL('../.build/native/installation.mjs', import.meta.url).href)};
const io={...fs, renameSync(from,to) { fs.renameSync(from,to); if(to===${JSON.stringify(join(f.root, 'bridge'))}) process.exit(79); }};
await installHelpers(${JSON.stringify(f.options)},{source:${JSON.stringify(f.native)}, environment:{}, verify:async()=>{}, filesystem:io});`,
  );
  const child = spawn(process.execPath, [script], { stdio: 'pipe' });
  expect((await once(child, 'exit'))[0]).toBe(79);
  expect(fs.existsSync(join(f.root, '.install-transaction.json'))).toBe(true);
  expect(command(f, 'saul')).toBe('tabs-v2');
  fs.unlinkSync(join(f.native, 'cli.mjs'));
  await expect(installHelpers(f.options, f.dependencies)).rejects.toThrow('ENOENT');
  expect(selected(f).generation).not.toBe(before.generation);
  expect(command(f, 'saul')).toBe('tabs-v2');
  expect(fs.existsSync(join(f.root, '.install-transaction.json'))).toBe(false);
});

it('refuses unexpected source/activation symlinks, foreign registrations and changed receipts', async () => {
  const f = fixture();
  await installHelpers(f.options, f.dependencies);
  const before = selected(f);
  fs.unlinkSync(join(f.native, 'cli.mjs'));
  fs.symlinkSync(join(f.native, 'host.mjs'), join(f.native, 'cli.mjs'));
  await expect(installHelpers(f.options, f.dependencies)).rejects.toThrow('source symlink');
  expect(selected(f).generation).toBe(before.generation);
  fs.unlinkSync(join(f.native, 'cli.mjs'));
  fs.writeFileSync(join(f.native, 'cli.mjs'), 'export {};');
  const registration = JSON.parse(fs.readFileSync(manifest(f), 'utf8'));
  fs.writeFileSync(manifest(f), JSON.stringify({ ...registration, path: '/somewhere/foreign' }));
  await expect(installHelpers(f.options, f.dependencies)).rejects.toThrow('another installation');
  fs.writeFileSync(manifest(f), JSON.stringify(registration));
  fs.writeFileSync(join(f.root, 'bridge', 'tabs', 'cli.mjs'), 'changed');
  await expect(installHelpers(f.options, f.dependencies)).rejects.toThrow(
    'generation file changed',
  );
  fs.unlinkSync(join(f.root, 'bridge'));
  fs.symlinkSync(f.native, join(f.root, 'bridge'));
  await expect(installHelpers(f.options, f.dependencies)).rejects.toThrow('activation symlink');
});

it('malformed recovery and live ticket metadata fail closed', async () => {
  const f = fixture();
  await installHelpers(f.options, f.dependencies);
  const original = fs.readlinkSync(join(f.root, 'bridge'));
  fs.writeFileSync(join(f.root, '.install-transaction.json'), '{"version":100}');
  await expect(installHelpers(f.options, f.dependencies)).rejects.toThrow('recovery journal');
  expect(fs.readlinkSync(join(f.root, 'bridge'))).toBe(original);
  fs.unlinkSync(join(f.root, '.install-transaction.json'));
  const id = 'a'.repeat(8) + '-aaaa-aaaa-aaaa-' + 'a'.repeat(12);
  fs.writeFileSync(
    join(f.root, '.install-locks', `l-${id}.json`),
    JSON.stringify({ version: 1, pid: process.pid, host: hostname(), token: id, ticket: 0 }),
  );
  await expect(installHelpers(f.options, f.dependencies)).rejects.toThrow(
    'Uncertain installation ticket',
  );
  expect(fs.readlinkSync(join(f.root, 'bridge'))).toBe(original);
});

it('rejects a syntax-invalid prepared module before activation through the default verifier', async () => {
  const f = fixture();
  await installHelpers(f.options, f.dependencies);
  const before = selected(f);
  fs.writeFileSync(join(f.native, 'cli.mjs'), 'this is not valid javascript!!!');
  const deps = {
    source: f.dependencies.source,
    jose: f.dependencies.jose,
    environment: f.dependencies.environment,
  };
  await expect(installHelpers(f.options, deps)).rejects.toThrow('syntax verification');
  expect(selected(f).generation).toBe(before.generation);
});

it('explicit recovery selects a retained complete generation and restores its registrations', async () => {
  const f = fixture();
  await installHelpers(f.options, f.dependencies);
  const first = selected(f);
  fs.writeFileSync(join(f.native, 'cli.mjs'), "console.log('tabs-v2');\n");
  await installHelpers({ ...f.options, extensionId: 'b'.repeat(32) }, f.dependencies);
  expect(command(f, 'saul')).toBe('tabs-v2');
  expect(selected(f).helper.manifest.allowed_origins).toHaveLength(2);
  restoreGeneration(f.root, first.generation);
  expect(selected(f).generation).toBe(first.generation);
  expect(selected(f).helper.manifest.allowed_origins).toHaveLength(1);
  expect(command(f, 'saul')).toBe('tabs-v1');
});

it('preserves the development credential directory and refuses installation over authored sources', async () => {
  const emittedHost = new URL('../.build/native/plan-host.mjs', import.meta.url);
  const sourceHost = new URL('../native/plan-host.mts', import.meta.url);
  expect(chatgptDirectory(emittedHost)).toBe(chatgptDirectory(sourceHost));
  await expect(
    installHelpers({
      extensionId: 'a'.repeat(32),
      installDir: fileURLToPath(new URL('../native/', import.meta.url)),
    }),
  ).rejects.toThrow('dedicated helper installation');
});
