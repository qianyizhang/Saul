import { createHash, randomUUID } from 'node:crypto';
import { mkdir, lstat, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join } from 'node:path';
import { checkAction } from './action-check.mts';
import { type ActionModule, type ActionRevision, validRevision } from './action-protocol.mts';

const WEEK = 7 * 24 * 60 * 60 * 1000;
export function actionHash(module: ActionModule) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        module.contractVersion,
        module.name,
        module.description,
        module.language,
        module.source,
      ]),
    )
    .digest('hex');
}
export class ActionStore {
  readonly directory: string;
  private now: () => number;
  constructor(directory: string, now = Date.now) {
    this.directory = directory;
    this.now = now;
  }
  private async folder() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('Action store must be a regular directory.');
  }
  private async write(value: ActionRevision) {
    await this.folder();
    const path = join(this.directory, value.revision + '.json');
    const temp = path + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
      await rename(temp, path);
    } finally {
      await unlink(temp).catch(() => {});
    }
  }
  async get(revision: string): Promise<ActionRevision> {
    if (!validRevision(revision)) throw new Error('Invalid action revision.');
    await this.folder();
    const path = join(this.directory, revision + '.json');
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 400_000)
      throw new Error('Invalid stored action revision.');
    const value = JSON.parse(await readFile(path, 'utf8')) as ActionRevision;
    const { revision: saved, createdAt, approved, ...module } = value;
    checkAction(module);
    if (
      saved !== revision ||
      actionHash(module) !== revision ||
      !Number.isFinite(createdAt) ||
      (approved !== undefined && typeof approved !== 'boolean')
    )
      throw new Error('Stored action revision changed. Stage and approve it explicitly.');
    return value;
  }
  async stage(value: unknown): Promise<ActionRevision> {
    const { module } = checkAction(value);
    const revision = actionHash(module);
    try {
      return await this.get(revision);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const result = { ...module, revision, createdAt: this.now() };
    await this.write(result);
    return result;
  }
  async file(path: string) {
    if (!isAbsolute(path) || !['.js', '.ts', '.mjs', '.mts'].includes(extname(path)))
      throw new Error('Use an absolute local JS or TS file path.');
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 60_000)
      throw new Error('Choose a regular file under 60 KB.');
    return this.stage({
      contractVersion: 1,
      name: basename(path),
      description: 'Local action module',
      language: /\.m?ts$/.test(path) ? 'typescript' : 'javascript',
      source: await readFile(path, 'utf8'),
    });
  }
  async approve(revision: string) {
    const value = { ...(await this.get(revision)), approved: true };
    await this.write(value);
    return value;
  }
  async prune(protect: Set<string>) {
    await this.folder();
    for (const name of await readdir(this.directory)) {
      const revision = name.replace(/\.json$/, '');
      if (!validRevision(revision) || protect.has(revision)) continue;
      const value = await this.get(revision);
      if (this.now() - value.createdAt > WEEK) await unlink(join(this.directory, name));
    }
  }
}
