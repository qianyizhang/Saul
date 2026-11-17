import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, writeFile, rename, rm, lstat } from 'node:fs/promises';
import { resolve, dirname, join, basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { helperPayloads, nativeAssets, nativeModules } from '../native/installation/components.mts';
import {
  invalidateNativeBuild,
  nativeBuildCurrent,
  nativeBuildFingerprint,
  recordNativeBuild,
} from './native-build-state.mts';

const root = fileURLToPath(new URL('../', import.meta.url));
const buildDirectory = join(root, '.build');
const output = join(buildDirectory, 'native');
const previous = await lstat(buildDirectory).catch((error: NodeJS.ErrnoException) => {
  if (error.code !== 'ENOENT') throw error;
});
if (previous?.isSymbolicLink()) throw new Error('Helper build directory must not be a symlink.');
await mkdir(buildDirectory, { recursive: true });
const lock = new DatabaseSync(join(buildDirectory, 'native-build.lock.sqlite3'));
try {
  // The OS releases the SQLite lock if a builder exits abruptly.
  lock.exec('PRAGMA busy_timeout=120000; BEGIN IMMEDIATE');
  const input = await nativeBuildFingerprint(root);
  if (await nativeBuildCurrent(root, input)) {
    console.error('Reusing verified native helper build.');
  } else {
    const scratch = await mkdtemp(join(buildDirectory, 'native-build-'));
    try {
      const staging = join(scratch, 'payload');
      await mkdir(join(staging, 'ui'), { recursive: true });
      const compiler = fileURLToPath(import.meta.resolve('typescript/bin/tsc'));
      function compile(project: string, ...args: string[]) {
        execFileSync(process.execPath, [compiler, '-p', project, ...args], {
          cwd: root,
          stdio: ['ignore', 2, 2],
        });
      }
      compile(
        'tsconfig.native.json',
        '--noEmit',
        'false',
        '--emitDeclarationOnly',
        '--declaration',
        '--rewriteRelativeImportExtensions',
        '--rootDir',
        root,
        '--outDir',
        join(staging, 'types'),
      );
      compile('tsconfig.board.json');
      compile('tsconfig.shared.json');
      compile('tsconfig.jxa.json', '--outFile', join(staging, 'window-names.jxa'));
      await build({
        entryPoints: [resolve(root, 'board/workspace.ts')],
        outfile: join(staging, 'ui/workspace.bundle.js'),
        bundle: true,
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        minify: true,
        legalComments: 'inline',
        logLevel: 'silent',
      });
      const aliases = new Map(
        Object.entries(nativeModules).map(([file, source]) => [resolve(root, source), file]),
      );
      const delivered = await build({
        entryPoints: Object.fromEntries(
          Object.entries(nativeModules).map(([file, source]) => [
            file.slice(0, -4),
            resolve(root, source),
          ]),
        ),
        outdir: staging,
        outExtension: { '.js': '.mjs' },
        bundle: true,
        external: ['typescript', 'typescript/*'],
        metafile: true,
        plugins: [
          {
            name: 'installed-module-paths',
            setup: ({ onResolve }) => {
              onResolve({ filter: /^\./ }, ({ path, importer, resolveDir }) => {
                if (!importer) return;
                const file = aliases.get(resolve(resolveDir, path));
                if (file) return { path: './' + file, external: true };
              });
            },
          },
        ],
        platform: 'node',
        format: 'esm',
        target: 'node24',
        logLevel: 'silent',
      });
      for (const [file, info] of Object.entries(delivered.metafile.outputs)) {
        for (const payload of Object.values(helperPayloads)) {
          if (!payload.includes(basename(file))) continue;
          for (const dependency of info.imports)
            if (dependency.path.startsWith('./') && !payload.includes(dependency.path.slice(2)))
              throw new Error(
                `Missing installed dependency ${dependency.path} for ${basename(file)}.`,
              );
        }
      }
      for (const [file, source] of Object.entries(nativeModules)) {
        // Typechecks of delivered entry paths resolve to their source types.
        const from = './types/' + source.replace(/\.mts$/, '.mjs');
        await writeFile(
          join(staging, file.replace(/\.mjs$/, '.d.mts')),
          `export * from ${JSON.stringify(from)};\n`,
        );
      }
      for (const [file, source] of Object.entries(nativeAssets)) {
        const target = join(staging, file);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(resolve(root, source), target);
      }
      await writeFile(
        join(staging, 'installation-root.json'),
        JSON.stringify({ version: 1, root }),
      );
      if ((await nativeBuildFingerprint(root)) !== input)
        throw new Error('Helper inputs changed during the build. Run the command again.');

      await invalidateNativeBuild(root);
      const backup = join(scratch, 'previous');
      let backedUp = false;
      try {
        await rename(output, backup);
        backedUp = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      try {
        await rename(staging, output);
      } catch (error) {
        if (backedUp) await rename(backup, output);
        throw error;
      }
      await recordNativeBuild(root, input);
      console.error('Built Saul helpers and Tab board.');
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
} finally {
  lock.close();
}
