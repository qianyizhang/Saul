import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, writeFile, rm, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const buildDirectory = new URL('.build/', root);
const previous = await lstat(buildDirectory).catch((error: NodeJS.ErrnoException) => {
  if (error.code !== 'ENOENT') throw error;
});
if (previous?.isSymbolicLink()) throw new Error('Helper build directory must not be a symlink.');
// Never ship stale output from a removed or renamed source file.
await rm(new URL('.build/native/', root), { recursive: true, force: true });
const compiler = fileURLToPath(import.meta.resolve('typescript/bin/tsc'));
for (const project of ['tsconfig.native.json', 'tsconfig.board.json', 'tsconfig.jxa.json']) {
  execFileSync(process.execPath, [compiler, '-p', project], { cwd: root, stdio: ['ignore', 2, 2] });
}
await import('./build-board.mts');
await mkdir(new URL('.build/native/ui/', root), { recursive: true });
for (const asset of ['workspace.html', 'workspace.css', 'design-tokens.css']) {
  await copyFile(new URL(`native/ui/${asset}`, root), new URL(`.build/native/ui/${asset}`, root));
}
// Development helpers keep the former native/../chatgpt directory; installs write their own root.
await writeFile(
  new URL('.build/native/installation-root.json', root),
  JSON.stringify({ version: 1, root: fileURLToPath(root) }),
);
