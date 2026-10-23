import { build } from 'esbuild';
import { writeFile, rename, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../.build/native/ui/workspace.bundle.js', import.meta.url));
const result = await build({
  entryPoints: [fileURLToPath(new URL('../native/ui/workspace.ts', import.meta.url))],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'inline',
  logLevel: 'silent',
});
await mkdir(new URL('../.build/native/ui/', import.meta.url), { recursive: true });
const temporary = `${output}.${process.pid}.tmp`;
try {
  await writeFile(temporary, result.outputFiles[0].contents);
  await rename(temporary, output);
} finally {
  await rm(temporary, { force: true });
}
console.error('Built self-contained Tab board.');
