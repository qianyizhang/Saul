import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fingerprintInputs } from '../../../scripts/build-identity.mts';

const receiptName = '.build/native-build.json';

async function outputFingerprint(root: string): Promise<string> {
  async function check(path: string): Promise<void> {
    const stat = await lstat(path);
    if (stat.isDirectory()) {
      for (const name of await readdir(path)) await check(join(path, name));
    } else if (!stat.isFile()) {
      throw new Error(`Helper output is not a regular file or directory: ${path}`);
    }
  }
  await check(join(root, '.build/native'));
  return fingerprintInputs(root, ['.build/native']);
}

export async function nativeBuildFingerprint(root: string): Promise<string> {
  // Development helpers embed this checkout's data root in installation-root.json.
  const appRoot = await realpath(root);
  const sources = await fingerprintInputs(resolve(root, '../..'), [
    'apps/saul/native',
    'apps/saul/src',
    'apps/saul/scripts/build-native.mts',
    'apps/saul/scripts/native-build-state.mts',
    'apps/saul/tsconfig.native.json',
    'apps/saul/tsconfig.board.json',
    'apps/saul/tsconfig.jxa.json',
    'apps/saul/package.json',
    'contracts',
    'scripts/build-identity.mts',
    'package.json',
    'pnpm-lock.yaml',
    '.node-version',
  ]);
  return createHash('sha256')
    .update(JSON.stringify([sources, appRoot, process.version, process.platform, process.arch]))
    .digest('hex');
}

export async function nativeBuildCurrent(root: string, input: string): Promise<boolean> {
  let receipt: unknown;
  try {
    receipt = JSON.parse(await readFile(join(root, receiptName), 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT')
      return false;
    throw error;
  }
  if (
    typeof receipt !== 'object' ||
    receipt === null ||
    !('input' in receipt) ||
    !('output' in receipt) ||
    receipt.input !== input
  )
    return false;
  try {
    return receipt.output === (await outputFingerprint(root));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function invalidateNativeBuild(root: string): Promise<void> {
  await rm(join(root, receiptName), { force: true });
}

export async function recordNativeBuild(root: string, input: string): Promise<void> {
  const output = await outputFingerprint(root);
  const receipt = join(root, receiptName);
  const temporary = `${receipt}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ input, output }) + '\n', { flag: 'wx' });
    await rename(temporary, receipt);
  } finally {
    await rm(temporary, { force: true });
  }
}
