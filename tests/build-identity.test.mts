import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { createBuildInfo, fingerprintInputs, verifyBuildInfo } from '../scripts/build-identity.mts';

test('app versions use independent three-part numeric semantic versions', () => {
  for (const version of ['1.0', '01.0.0', '0.1.0-dev', '65536.0.0'])
    assert.throws(() => createBuildInfo('saul', version, 'source', 'compiler'), /Invalid.*version/);
  assert.equal(createBuildInfo('saul', '0.0.0', 'source', 'compiler').version, '0.0.0');
  assert.equal(createBuildInfo('ez', '0.1.0', 'source', 'compiler').version, '0.1.0');
});

test('input identity includes dirty bytes, path changes, missing inputs, and rejects unsafe links', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'build-inputs-'));
  try {
    await mkdir(join(dir, 'src'));
    await writeFile(join(dir, 'src/input'), 'before');
    const before = await fingerprintInputs(dir, ['src', 'optional']);
    assert.equal(before, await fingerprintInputs(dir, ['optional', 'src']));
    await writeFile(join(dir, 'src/input'), 'after');
    assert.notEqual(before, await fingerprintInputs(dir, ['src', 'optional']));
    await symlink(join(dir, 'src/input'), join(dir, 'src/alias'));
    const linked = await fingerprintInputs(dir, ['src']);
    await writeFile(join(dir, 'src/input'), 'changed linked bytes');
    assert.notEqual(linked, await fingerprintInputs(dir, ['src']));
    await symlink(tmpdir(), join(dir, 'src/outside'));
    await assert.rejects(fingerprintInputs(dir, ['src']), /inside the repository/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'darwin')(
  'standalone Swift identity and TypeScript verifier agree',
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'build-swift-'));
    try {
      await mkdir(join(dir, 'apps/ez/Resources'), { recursive: true });
      await writeFile(join(dir, 'apps/ez/build-inputs.json'), '["apps/ez/Resources","missing"]');
      await writeFile(
        join(dir, 'apps/ez/Resources/Info.plist'),
        '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>0.1.0</string></dict></plist>',
      );
      const output = join(dir, 'build-info.json');
      await symlink(
        join(dir, 'apps/ez/Resources/Info.plist'),
        join(dir, 'apps/ez/Resources/linked.plist'),
      );
      execFileSync(
        '/usr/bin/swift',
        ['apps/ez/scripts/build-identity.swift', 'prepare', dir, output],
        { env: { ...process.env, CLANG_MODULE_CACHE_PATH: join(dir, 'modules') } },
      );
      const info = await verifyBuildInfo(output, dir, 'ez');
      assert.equal(info.version, '0.1.0');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  30_000,
);
