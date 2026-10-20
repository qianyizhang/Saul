import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { cleanArtifacts } from '../scripts/clean-artifacts.mjs';

let root;
let artifacts;
const log = () => {};

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'artifact-cleanup-'));
  execFileSync('git', ['init', '--quiet', root]);
  artifacts = path.join(root, '.artifacts');
  await mkdir(path.join(artifacts, 'run'), { recursive: true });
  await writeFile(path.join(artifacts, 'run', 'trace.zip'), 'diagnostics');
  await mkdir(path.join(root, '.output'));
  await writeFile(path.join(root, '.output', 'installed'), 'keep');
});
afterEach(async () => rm(root, { recursive: true, force: true }));

it('previews by default and deletes only artifact contents on apply', async () => {
  await cleanArtifacts(root, { log });
  expect(await readFile(path.join(artifacts, 'run', 'trace.zip'), 'utf8')).toBe('diagnostics');
  await cleanArtifacts(root, { apply: true, log });
  expect(await readdir(artifacts)).toEqual([]);
  expect(await readFile(path.join(root, '.output', 'installed'), 'utf8')).toBe('keep');
});

it('unlinks nested symlinks without traversing their targets', async () => {
  await symlink(path.join(root, '.output'), path.join(artifacts, 'external'));
  await cleanArtifacts(root, { apply: true, log });
  expect(await readFile(path.join(root, '.output', 'installed'), 'utf8')).toBe('keep');
});

it('refuses a symlink at the cleanup root', async () => {
  await rm(artifacts, { recursive: true });
  await symlink(path.join(root, '.output'), artifacts);
  await expect(cleanArtifacts(root, { apply: true, log })).rejects.toThrow('real directory');
  expect(await readFile(path.join(root, '.output', 'installed'), 'utf8')).toBe('keep');
});

it('refuses tracked artifacts before deleting anything', async () => {
  execFileSync('git', ['add', '.artifacts'], { cwd: root });
  await expect(cleanArtifacts(root, { apply: true, log })).rejects.toThrow('tracked files');
  expect(await readFile(path.join(artifacts, 'run', 'trace.zip'), 'utf8')).toBe('diagnostics');
});

it('accepts an absent artifact directory', async () => {
  await rm(artifacts, { recursive: true });
  await expect(cleanArtifacts(root, { apply: true, log })).resolves.toBeUndefined();
});
