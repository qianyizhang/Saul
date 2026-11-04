import { expect, it } from 'vitest';
import { cp, mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  invalidateNativeBuild,
  nativeBuildCurrent,
  nativeBuildFingerprint,
  recordNativeBuild,
} from '../scripts/native-build-state.mts';

it('rebuilds a copied checkout instead of reusing another checkout data root', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'saul-native-copy-'));
  const original = join(directory, 'original/apps/saul');
  const copied = join(directory, 'copied/apps/saul');
  try {
    await mkdir(join(original, '.build/native'), { recursive: true });
    await mkdir(copied, { recursive: true });
    await writeFile(
      join(original, '.build/native/installation-root.json'),
      JSON.stringify({ version: 1, root: original }),
    );
    const originalInput = await nativeBuildFingerprint(original);
    await recordNativeBuild(original, originalInput);
    expect(await nativeBuildCurrent(original, originalInput)).toBe(true);
    await cp(join(original, '.build'), join(copied, '.build'), { recursive: true });
    expect(await nativeBuildCurrent(copied, await nativeBuildFingerprint(copied))).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('invalidates helpers when imported browser sources or the shared schema change', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'saul-native-inputs-'));
  const root = join(repo, 'apps/saul');
  try {
    await mkdir(join(root, 'src/storage'), { recursive: true });
    await mkdir(join(repo, 'contracts'));
    const source = join(root, 'src/storage/db.ts');
    const schema = join(repo, 'contracts/history.sql');
    await writeFile(source, 'export const version = 1;');
    await writeFile(schema, 'CREATE TABLE attempts (id TEXT);');
    const initial = await nativeBuildFingerprint(root);
    expect(await nativeBuildFingerprint(root)).toBe(initial);
    await writeFile(source, 'export const version = 2;');
    expect(await nativeBuildFingerprint(root)).not.toBe(initial);
    await rm(source);
    expect(await nativeBuildFingerprint(root)).not.toBe(initial);
    await writeFile(source, 'export const version = 1;');
    expect(await nativeBuildFingerprint(root)).toBe(initial);
    await writeFile(schema, 'CREATE TABLE attempts (id TEXT, state TEXT);');
    expect(await nativeBuildFingerprint(root)).not.toBe(initial);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

it('reuses only a completed build with identical inputs and exact output inventory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'saul-native-build-'));
  const directory = join(root, '.build/native');
  try {
    await mkdir(directory, { recursive: true });
    const output = join(directory, 'helper.mjs');
    await writeFile(output, 'first');
    expect(await nativeBuildCurrent(root, 'source-a')).toBe(false);
    await recordNativeBuild(root, 'source-a');
    expect(await nativeBuildCurrent(root, 'source-a')).toBe(true);
    expect(await nativeBuildCurrent(root, 'source-b')).toBe(false);
    await writeFile(output, 'changed');
    expect(await nativeBuildCurrent(root, 'source-a')).toBe(false);
    await writeFile(output, 'first');
    await writeFile(join(directory, 'stale.mjs'), 'obsolete');
    expect(await nativeBuildCurrent(root, 'source-a')).toBe(false);
    await rm(join(directory, 'stale.mjs'));
    await rm(output);
    expect(await nativeBuildCurrent(root, 'source-a')).toBe(false);
    await writeFile(output, 'first');
    await invalidateNativeBuild(root);
    expect(await nativeBuildCurrent(root, 'source-a')).toBe(false);
    await writeFile(join(root, '.build/native-build.json'), '{');
    expect(await nativeBuildCurrent(root, 'source-a')).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('rejects symlinked output instead of trusting a valid completion receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'saul-native-build-link-'));
  try {
    await mkdir(join(root, '.build/native'), { recursive: true });
    await writeFile(join(root, '.build/native/helper.mjs'), 'first');
    await recordNativeBuild(root, 'source');
    await rm(join(root, '.build/native/helper.mjs'));
    await writeFile(join(root, 'external.mjs'), 'first');
    await symlink(join(root, 'external.mjs'), join(root, '.build/native/helper.mjs'));
    await expect(nativeBuildCurrent(root, 'source')).rejects.toThrow(/not a regular file/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
