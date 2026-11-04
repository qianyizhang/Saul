import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Hash exact inputs, including dirty source and repo-owned contract file links. */
export async function fingerprintInputs(root: string, inputs: readonly string[]): Promise<string> {
  root = await realpath(root);
  const records = new Map<string, string>();
  async function visit(path: string): Promise<void> {
    const name = relative(root, path).split('\\').join('/');
    if (!name || name.startsWith('../') || name.includes('\n') || name.includes('\0'))
      throw new Error(`Invalid build input path: ${path}`);
    const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (!stat) {
      records.set(name, 'missing');
    } else if (stat.isDirectory()) {
      records.set(name + '/', 'directory');
      for (const child of (await readdir(path)).sort()) await visit(join(path, child));
    } else if (stat.isSymbolicLink()) {
      const target = await realpath(path);
      const targetName = relative(root, target).split('\\').join('/');
      if (targetName.startsWith('../') || !(await lstat(target)).isFile())
        throw new Error(
          `Build input link must target a regular file inside the repository: ${path}`,
        );
      records.set(name, `link:${targetName}:${digest(await readFile(target))}`);
    } else if (stat.isFile()) {
      records.set(name, digest(await readFile(path)));
    } else {
      throw new Error(`Build input is not a regular file or directory: ${path}`);
    }
  }
  for (const input of inputs) await visit(resolve(root, input));
  return digest(
    [...records]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, hash]) => `${name}\0${hash}\n`)
      .join(''),
  );
}

export type BuildInfo = {
  format: 1;
  app: 'saul' | 'ez';
  version: string;
  source: string;
  toolchain: string;
  build: string;
};

export function createBuildInfo(
  app: BuildInfo['app'],
  version: string,
  source: string,
  toolchain: string,
): BuildInfo {
  if (
    !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version) ||
    version.split('.').some((part) => Number(part) > 65535)
  )
    throw new Error(`Invalid ${app} version: use three integers from 0 to 65535.`);
  return {
    format: 1,
    app,
    version,
    source,
    toolchain,
    build: digest(`${app}\0${version}\0${source}\0${toolchain}`),
  };
}

export async function appSourceFingerprint(repo: string, app: BuildInfo['app']): Promise<string> {
  const inputs: unknown = JSON.parse(
    await readFile(join(repo, `apps/${app}/build-inputs.json`), 'utf8'),
  );
  if (!Array.isArray(inputs) || !inputs.length || !inputs.every((item) => typeof item === 'string'))
    throw new Error(`Invalid ${app} build input selection.`);
  return fingerprintInputs(repo, inputs);
}

export async function verifyBuildInfo(
  path: string,
  repo: string,
  app: BuildInfo['app'],
): Promise<BuildInfo> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null)
    throw new Error(`Invalid ${app} build identity: ${path}`);
  const info = parsed as Partial<BuildInfo>;
  if (
    info.format !== 1 ||
    info.app !== app ||
    typeof info.version !== 'string' ||
    typeof info.toolchain !== 'string' ||
    typeof info.source !== 'string' ||
    !/^[a-f0-9]{64}$/.test(info.source) ||
    info.build !== createBuildInfo(app, info.version, info.source, info.toolchain).build
  )
    throw new Error(`Invalid ${app} build identity: ${path}`);
  if (info.source !== (await appSourceFingerprint(repo, app)))
    throw new Error(
      `Prepared ${app} build is stale. Build the current source before verification.`,
    );
  return info as BuildInfo;
}

/** Compare complete artifact trees. Signature validity is checked separately. */
export async function verifyArtifactTree(expected: string, installed: string): Promise<void> {
  async function inventory(root: string): Promise<Map<string, string>> {
    const entries = new Map<string, string>();
    async function visit(path: string): Promise<void> {
      const stat = await lstat(path);
      const name = relative(root, path);
      if (stat.isSymbolicLink()) throw new Error(`Artifact symlink is not supported: ${path}`);
      if (stat.isDirectory()) {
        if (name) entries.set(name + '/', 'directory');
        for (const child of (await readdir(path)).sort()) await visit(join(path, child));
      } else if (stat.isFile()) entries.set(name, digest(await readFile(path)));
      else throw new Error(`Unsupported artifact file: ${path}`);
    }
    await visit(root);
    return entries;
  }
  const expectedFiles = await inventory(expected);
  const installedFiles = await inventory(installed);
  for (const name of new Set([...expectedFiles.keys(), ...installedFiles.keys()]))
    if (expectedFiles.get(name) !== installedFiles.get(name))
      throw new Error(`Installed artifact differs from the prepared build: ${name}`);
}
