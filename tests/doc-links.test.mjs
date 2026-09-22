import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { checkLinks } from '../scripts/check-links.mjs';

const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('resolves reference links, encoded paths, duplicate headings, images and explicit anchors', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saul-links-'));
  roots.push(root);
  await writeFile(path.join(root, 'guide notes.md'), '# **Setup**\n# Setup\n<a id="custom"></a>\n');
  await writeFile(path.join(root, 'image.svg'), '<svg/>');
  await writeFile(
    path.join(root, 'README.md'),
    '[guide][ref]\n\n[ref]: guide%20notes.md#setup-1\n\n[custom](guide%20notes.md#custom)\n![image](image.svg)\n[external](https://example.invalid/missing)\n`[code](missing.md)`\n',
  );
  expect(await checkLinks(root, ['README.md'])).toEqual([]);
});

it('reports deleted pages and renamed anchors, including reference links and images', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saul-links-'));
  roots.push(root);
  await writeFile(
    path.join(root, 'README.md'),
    '# Present\n[old][ref]\n\n[ref]: gone.md\n\n[heading](#old)\n![image](missing.png)\n',
  );
  const failures = await checkLinks(root, ['README.md']);
  expect(failures).toHaveLength(3);
  expect(failures.join('\n')).toContain('gone.md (missing target)');
  expect(failures.join('\n')).toContain('missing heading #old');
  expect(failures.join('\n')).toContain('missing.png (missing target)');
});

it('rejects targets outside the repository even when they exist locally', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saul-links-'));
  roots.push(root);
  await writeFile(path.join(root, 'README.md'), '[outside](../)\n');
  expect(await checkLinks(root, ['README.md'])).toEqual([
    'README.md: ../ (target escapes repository)',
  ]);
});
