import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, writeFile, rename, rm, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

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
const output = fileURLToPath(new URL('.build/native/ui/workspace.bundle.js', root));
const result = await build({
  entryPoints: [fileURLToPath(new URL('native/ui/workspace.ts', root))],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'inline',
  logLevel: 'silent',
});
await mkdir(new URL('.build/native/ui/', root), { recursive: true });
const temporary = `${output}.${process.pid}.tmp`;
try {
  await writeFile(temporary, result.outputFiles[0].contents);
  await rename(temporary, output);
} finally {
  await rm(temporary, { force: true });
}
console.error('Built self-contained Tab board.');

for (const asset of ['workspace.html', 'workspace.css', 'design-tokens.css']) {
  await copyFile(new URL(`native/ui/${asset}`, root), new URL(`.build/native/ui/${asset}`, root));
}
// Development helpers keep the former native/../chatgpt directory; installs write their own root.
await writeFile(
  new URL('.build/native/installation-root.json', root),
  JSON.stringify({ version: 1, root: fileURLToPath(root) }),
);
