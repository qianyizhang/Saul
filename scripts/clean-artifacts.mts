import { execFileSync } from 'node:child_process';
import { lstat, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Only diagnostics belong here. Build/install trees are deliberately outside this boundary.
export async function cleanArtifacts(root: string, { apply = false, log = console.log } = {}) {
  const directory = path.join(root, '.artifacts');
  const stat = await lstat(directory).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!stat) {
    log('No .artifacts directory to clean.');
    return;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Refusing cleanup: .artifacts must be a real directory.');
  }
  const tracked = execFileSync('git', ['ls-files', '-z', '--', '.artifacts'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (tracked) throw new Error('Refusing cleanup: .artifacts contains tracked files.');

  let files = 0;
  let bytes = 0;
  async function measure(entry: string): Promise<void> {
    const info = await lstat(entry);
    if (info.isDirectory()) {
      for (const name of await readdir(entry)) await measure(path.join(entry, name));
    } else {
      files++;
      bytes += info.size;
    }
  }
  const entries = await readdir(directory);
  for (const entry of entries) {
    await measure(path.join(directory, entry));
    log(`.artifacts/${entry}`);
  }
  log(`${apply ? 'Removing' : 'Would remove'} ${files} files (${bytes} bytes).`);
  if (apply) {
    // rm unlinks nested symlinks; it does not follow them into installed/user data.
    for (const entry of entries) await rm(path.join(directory, entry), { recursive: true });
  } else {
    log('After stopping artifact-producing runs, repeat with --apply to delete.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== '--apply')) {
      throw new Error('Usage: pnpm artifacts:clean [--apply] (preview by default)');
    }
    await cleanArtifacts(fileURLToPath(new URL('..', import.meta.url)), {
      apply: args[0] === '--apply',
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
