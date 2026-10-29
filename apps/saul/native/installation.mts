import { isRecord } from './value.mts';
import { errorMessage } from './transport.mts';
export type Component = 'tabs' | 'chatgpt';
type InstallationFs = typeof fs;
interface NativeManifest {
  name: string;
  description?: string;
  path: string;
  type: string;
  allowed_origins: string[];
}
interface HelperConfiguration {
  node: string;
  proxy: Record<string, string>;
  manifestPath: string;
  manifest: NativeManifest;
}
interface GenerationReceipt {
  version: 1;
  root: string;
  generation: string;
  previous: string | null;
  helpers: Partial<Record<Component, HelperConfiguration>>;
  files: Record<string, string>;
}
type LoadedGeneration = GenerationReceipt & { path: string; legacy?: false };
type ActiveInstallation =
  | LoadedGeneration
  | { legacy: true; generation?: never; helpers?: never; path?: never }
  | undefined;
interface FileSnapshot {
  data: string;
  mode: number;
}
interface RegistrationChange {
  path: string;
  before: FileSnapshot | null;
  after: string | null;
}
interface InstallationJournal {
  version: 1;
  id: string;
  next: string;
  previous: string | null;
  legacy: boolean;
  hadBin: boolean;
  registrations: RegistrationChange[];
}
interface InstallationTicket {
  version: 1;
  pid: number;
  host: string;
  token: string;
  ticket: number | null;
}
export interface InstallOptions {
  extensionId?: string;
  browser?: string;
  installDir?: string;
  manifestDir?: string;
  platform?: string;
  home?: string;
  chatgpt?: boolean;
  components?: string[];
  migrateLegacy?: boolean;
}
interface InstallDependencies {
  source?: string;
  jose?: string;
  node?: string;
  environment?: NodeJS.ProcessEnv;
  filesystem?: InstallationFs;
  inspectLegacyProcesses?: (root: string) => number;
  verify?: (path: string, node: string, io: InstallationFs) => void | Promise<void>;
}
import { errorCode } from './value.mts';
import * as fs from 'node:fs';
import { dirname, basename, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, hostname } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PLAN_HOST } from './plan-protocol.mts';
import { HOST_NAME } from './protocol.mts';

export const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const sourceRoot = dirname(fileURLToPath(import.meta.url));
const authoredSource =
  basename(dirname(sourceRoot)) === '.build' ? resolve(sourceRoot, '../../native') : sourceRoot;
const proxyKeys = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
];
const entries: Record<string, string[]> = {
  tabs: ['host.mjs', 'cli.mjs', 'mcp.mjs', 'board-web.mjs'],
  chatgpt: ['plan-host.mjs'],
};
export const payloadFiles: Record<string, string[]> = {
  tabs: [
    'value.mjs',
    'workspace-contract.mjs',
    'results.mjs',
    'protocol.mjs',
    'transport.mjs',
    'host.mjs',
    'client.mjs',
    'cli.mjs',
    'mcp.mjs',
    'app-protocol.mjs',
    'board-resource.mjs',
    'board-service.mjs',
    'board-web.mjs',
    'board-http.mjs',
    'diagnostic-events.mjs',
    'diagnostic-protocol.mjs',
    'diagnostic-store.mjs',
    'workspace.mjs',
    'tab-layout.mjs',
    'window-labels.mjs',
    'window-names.mjs',
    'window-names.jxa',
    'ui/workspace.html',
    'ui/workspace.css',
    'ui/design-tokens.css',
    'ui/workspace.bundle.js',
  ],
  chatgpt: [
    'value.mjs',
    'protocol.mjs',
    'transport.mjs',
    'plan-protocol.mjs',
    'plan-host.mjs',
    'plan-service.mjs',
    'plan-models.mjs',
    'shared-presets.mjs',
    'shared-presets-contract.mjs',
    'plan-auth.mjs',
    'plan-store.mjs',
    'responses.mjs',
    'sse.mjs',
    'installation-paths.mjs',
  ],
};
const uuidPattern = '[a-f\\d]{8}-[a-f\\d]{4}-[a-f\\d]{4}-[a-f\\d]{4}-[a-f\\d]{12}';
const generationPattern = new RegExp(`^g-${uuidPattern}$`);
const transactionPattern = new RegExp(`^${uuidPattern}$`);
const own = (info: fs.Stats) =>
  typeof process.getuid !== 'function' || info.uid === process.getuid();
const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

export function installationPlan({
  extensionId,
  browser = 'chrome',
  installDir,
  manifestDir,
  platform = process.platform,
  home = homedir(),
  chatgpt = false,
}: InstallOptions) {
  if (!/^[a-p]{32}$/.test(extensionId ?? ''))
    throw new Error('--extension-id must be the 32-letter ID shown in chrome://extensions');
  const browsers: Record<string, Record<string, string>> = {
    darwin: {
      chrome: 'Library/Application Support/Google/Chrome',
      chromium: 'Library/Application Support/Chromium',
      edge: 'Library/Application Support/Microsoft Edge',
      brave: 'Library/Application Support/BraveSoftware/Brave-Browser',
    },
    linux: {
      chrome: '.config/google-chrome',
      chromium: '.config/chromium',
      edge: '.config/microsoft-edge',
      brave: '.config/BraveSoftware/Brave-Browser',
    },
  };
  if (!browsers[platform]?.[browser])
    throw new Error('Supported: macOS/Linux; chrome, chromium, edge, brave');
  const root = resolve(installDir ?? join(home, '.saul'));
  const component = chatgpt ? 'chatgpt' : 'tabs';
  return {
    root,
    bin: join(root, 'bin'),
    runtime: join(root, 'bridge'),
    component,
    manifestPath: join(
      resolve(manifestDir ?? join(home, browsers[platform][browser], 'NativeMessagingHosts')),
      `${chatgpt ? PLAN_HOST : HOST_NAME}.json`,
    ),
    manifest: {
      name: chatgpt ? PLAN_HOST : HOST_NAME,
      description: chatgpt ? 'Saul ChatGPT plan provider' : 'Saul local tab bridge',
      path: join(root, 'bin', chatgpt ? 'saul-chatgpt-host' : 'saul-native-host'),
      type: 'stdio',
      allowed_origins: [`chrome-extension://${extensionId}/`],
    },
  };
}

function info(path: string, io: InstallationFs) {
  try {
    return io.lstatSync(path);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return;
    throw error;
  }
}
function directory(path: string, io: InstallationFs, create = false) {
  if (create) io.mkdirSync(path, { recursive: true, mode: 0o700 });
  const value = info(path, io);
  if (!value?.isDirectory() || value.isSymbolicLink() || !own(value))
    throw new Error(`Expected an owned directory without a symlink: ${path}`);
}
function regular(path: string, io: InstallationFs) {
  const value = io.lstatSync(path);
  if (!value.isFile() || value.isSymbolicLink() || !own(value))
    throw new Error(`Expected an owned regular file: ${path}`);
  return value;
}
function canonicalRoot(path: string, io: InstallationFs) {
  path = resolve(path);
  const value = info(path, io);
  if (value?.isSymbolicLink()) throw new Error('Installation root must not be a symlink.');
  directory(path, io, true);
  const root = io.realpathSync(path);
  if ([resolve('/'), io.realpathSync(homedir()), sourceRoot, authoredSource].includes(root))
    throw new Error('Choose a dedicated helper installation directory.');
  io.chmodSync(root, 0o700);
  return root;
}
function syncDirectory(path: string, io: InstallationFs) {
  const fd = io.openSync(path, 'r');
  try {
    io.fsyncSync(fd);
  } finally {
    io.closeSync(fd);
  }
}
function writeFile(path: string, data: string | Uint8Array, mode: number, io: InstallationFs) {
  const fd = io.openSync(path, 'wx', mode);
  try {
    io.writeFileSync(fd, data);
    io.fsyncSync(fd);
  } finally {
    io.closeSync(fd);
  }
}
function atomicFile(path: string, data: string | Uint8Array, mode: number, io: InstallationFs) {
  const temp = join(dirname(path), `.${basename(path)}-${randomUUID()}.tmp`);
  try {
    writeFile(temp, data, mode, io);
    io.renameSync(temp, path);
    syncDirectory(dirname(path), io);
  } finally {
    if (info(temp, io)) io.unlinkSync(temp);
  }
}
function atomicLink(path: string, target: string, io: InstallationFs) {
  const temp = join(dirname(path), `.${basename(path)}-${randomUUID()}.tmp`);
  try {
    io.symlinkSync(target, temp);
    io.renameSync(temp, path);
    syncDirectory(dirname(path), io);
  } finally {
    if (info(temp, io)) io.unlinkSync(temp);
  }
}
function safeFiles(root: string, io: InstallationFs) {
  const files: string[] = [];
  const visit = (path: string): void => {
    const value = io.lstatSync(path);
    if (!own(value) || value.isSymbolicLink())
      throw new Error(`Unexpected owner or symlink in payload: ${path}`);
    if (value.isDirectory())
      for (const name of io.readdirSync(path).sort()) visit(join(path, name));
    else if (value.isFile()) files.push(relative(root, path));
    else throw new Error(`Unsupported payload file: ${path}`);
  };
  visit(root);
  return files;
}
function copyTree(source: string, target: string, io: InstallationFs): void {
  const value = io.lstatSync(source);
  if (value.isSymbolicLink() || !own(value))
    throw new Error(`Unexpected source symlink or owner: ${source}`);
  if (value.isDirectory()) {
    io.mkdirSync(target, { recursive: true, mode: 0o700 });
    for (const name of io.readdirSync(source)) copyTree(join(source, name), join(target, name), io);
  } else if (value.isFile()) {
    io.mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFile(target, io.readFileSync(source), 0o600, io);
  } else throw new Error(`Unsupported payload file: ${source}`);
}
function receipt(root: string, name: string, io: InstallationFs): LoadedGeneration {
  if (!generationPattern.test(name)) throw new Error('Invalid helper generation selection.');
  const path = join(root, 'generations', name);
  directory(join(root, 'generations'), io);
  directory(path, io);
  regular(join(path, 'installation.json'), io);
  let value: unknown;
  try {
    value = JSON.parse(io.readFileSync(join(path, 'installation.json'), 'utf8'));
  } catch (error) {
    throw new Error('Invalid helper generation metadata.', { cause: error });
  }
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.root !== root ||
    value.generation !== name ||
    !isRecord(value.helpers) ||
    !Object.keys(value.helpers).length ||
    Object.keys(value.helpers).some((c) => !entries[c]) ||
    (value.previous !== null &&
      (typeof value.previous !== 'string' || !generationPattern.test(value.previous))) ||
    !isRecord(value.files) ||
    Array.isArray(value.files)
  )
    throw new Error('Invalid helper generation metadata.');
  for (const [component, helper] of Object.entries(value.helpers)) {
    if (
      !isRecord(helper) ||
      typeof helper.node !== 'string' ||
      !isAbsolute(helper.node) ||
      !isRecord(helper.proxy) ||
      Array.isArray(helper.proxy) ||
      Object.keys(helper.proxy).some(
        (key) =>
          !proxyKeys.includes(key) ||
          typeof (helper.proxy as Record<string, unknown>)[key] !== 'string',
      ) ||
      typeof helper.manifestPath !== 'string' ||
      !isAbsolute(helper.manifestPath) ||
      !isRecord(helper.manifest) ||
      helper.manifest.name !== (component === 'tabs' ? HOST_NAME : PLAN_HOST) ||
      helper.manifest?.path !==
        join(root, 'bin', component === 'tabs' ? 'saul-native-host' : 'saul-chatgpt-host') ||
      helper.manifest?.type !== 'stdio' ||
      !Array.isArray(helper.manifest?.allowed_origins) ||
      !helper.manifest.allowed_origins.length ||
      helper.manifest.allowed_origins.some(
        (v) => typeof v !== 'string' || !/^chrome-extension:\/\/[a-p]{32}\/$/.test(v),
      )
    )
      throw new Error('Invalid installed helper metadata.');
  }
  const paths = safeFiles(path, io).filter((file) => file !== 'installation.json');
  if (JSON.stringify(paths.sort()) !== JSON.stringify(Object.keys(value.files).sort()))
    throw new Error('Helper generation inventory does not match its receipt.');
  for (const file of paths)
    if (hash(io.readFileSync(join(path, file))) !== value.files[file])
      throw new Error(`Helper generation file changed: ${file}`);
  return { ...(value as unknown as GenerationReceipt), path };
}
function active(root: string, io: InstallationFs): ActiveInstallation {
  const bridge = info(join(root, 'bridge'), io);
  if (!bridge) return;
  if (bridge.isDirectory()) return { legacy: true };
  if (!bridge.isSymbolicLink()) throw new Error('Unexpected installed bridge path.');
  const target = io.readlinkSync(join(root, 'bridge'));
  if (
    !target.startsWith('generations/') ||
    !generationPattern.test(target.slice('generations/'.length))
  )
    throw new Error('Unexpected helper activation symlink.');
  const bin = info(join(root, 'bin'), io);
  if (!bin?.isSymbolicLink() || io.readlinkSync(join(root, 'bin')) !== 'bridge/bin')
    throw new Error('Unexpected installed launcher directory.');
  return receipt(root, target.slice('generations/'.length), io);
}
function snapshot(path: string, io: InstallationFs): FileSnapshot | null {
  const value = info(path, io);
  if (!value) return null;
  regular(path, io);
  return { data: io.readFileSync(path).toString('base64'), mode: value.mode & 0o777 };
}
function currentTarget(root: string, io: InstallationFs) {
  const value = info(join(root, 'bridge'), io);
  return value?.isSymbolicLink() ? io.readlinkSync(join(root, 'bridge')) : null;
}
function removeExpectedLink(path: string, target: string, io: InstallationFs) {
  const value = info(path, io);
  if (!value) return;
  if (!value.isSymbolicLink() || io.readlinkSync(path) !== target)
    throw new Error(`Recovery found an unexpected path: ${path}`);
  io.unlinkSync(path);
}
function recover(root: string, io: InstallationFs) {
  const path = join(root, '.install-transaction.json');
  if (!info(path, io)) return;
  regular(path, io);
  let journal: InstallationJournal;
  try {
    journal = JSON.parse(io.readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error('Invalid installation recovery journal; preserve it for inspection.', {
      cause: error,
    });
  }
  if (
    journal?.version !== 1 ||
    !transactionPattern.test(journal.id) ||
    !generationPattern.test(journal.next) ||
    (journal.previous !== null && !generationPattern.test(journal.previous)) ||
    typeof journal.legacy !== 'boolean' ||
    typeof journal.hadBin !== 'boolean' ||
    !Array.isArray(journal.registrations)
  )
    throw new Error('Invalid installation recovery journal; preserve it for inspection.');
  const prepared = receipt(root, journal.next, io);
  const previous = journal.previous ? receipt(root, journal.previous, io) : undefined;
  const known = new Map(
    [...Object.values(previous?.helpers ?? {}), ...Object.values(prepared.helpers)].map(
      (helper) => [helper.manifestPath, helper],
    ),
  );
  for (const item of journal.registrations) {
    if (
      !known.has(item.path) ||
      !isAbsolute(item.path ?? '') ||
      ![`${HOST_NAME}.json`, `${PLAN_HOST}.json`].includes(basename(item.path)) ||
      (item.after !== null && typeof item.after !== 'string') ||
      (item.before !== null &&
        (typeof item.before?.data !== 'string' ||
          !Number.isInteger(item.before?.mode) ||
          item.before.mode < 0 ||
          item.before.mode > 0o777))
    )
      throw new Error('Invalid installation recovery registration.');
    const desired = Object.values(prepared.helpers).find(
      (helper) => helper.manifestPath === item.path,
    );
    const after = desired
      ? Buffer.from(JSON.stringify(desired.manifest, null, 2) + '\n').toString('base64')
      : null;
    if (item.after !== after)
      throw new Error('Recovery registration disagrees with its prepared generation.');
    if (item.before) {
      let old;
      try {
        old = JSON.parse(Buffer.from(item.before.data, 'base64').toString('utf8'));
      } catch (error) {
        throw new Error('Invalid prior recovery registration.', { cause: error });
      }
      const expected = known.get(item.path)!.manifest;
      const suffix = '/bin/' + basename(expected.path);
      if (
        old?.name !== expected.name ||
        old.type !== 'stdio' ||
        typeof old.path !== 'string' ||
        !old.path.endsWith(suffix) ||
        io.realpathSync(old.path.slice(0, -suffix.length)) !== root ||
        !Array.isArray(old.allowed_origins) ||
        old.allowed_origins.some(
          (origin: unknown) =>
            typeof origin !== 'string' || !/^chrome-extension:\/\/[a-p]{32}\/$/.test(origin),
        )
      )
        throw new Error('Invalid prior recovery registration.');
    }
  }
  if (currentTarget(root, io) === `generations/${journal.next}`) {
    receipt(root, journal.next, io);
    io.unlinkSync(path);
    return;
  }
  if (currentTarget(root, io) !== (journal.previous ? `generations/${journal.previous}` : null))
    throw new Error('Installation selection changed during recovery; inspect it before retrying.');
  for (const item of [...journal.registrations].reverse()) {
    const now = snapshot(item.path, io);
    if (now && now.data !== item.after && now.data !== item.before?.data)
      throw new Error('Host registration changed during recovery; refusing to overwrite it.');
    if (item.before)
      atomicFile(item.path, Buffer.from(item.before.data, 'base64'), item.before.mode, io);
    else if (now) io.unlinkSync(item.path);
  }
  if (journal.legacy) {
    const backup = join(root, `.legacy-${journal.id}`);
    for (const name of ['bridge', 'bin']) {
      const old = join(backup, name);
      if (!info(old, io)) continue;
      directory(old, io);
      const target = join(root, name);
      if (name === 'bin') removeExpectedLink(target, 'bridge/bin', io);
      else if (info(target, io)) throw new Error('Legacy bridge changed during recovery.');
      io.renameSync(old, target);
    }
  } else if (!journal.previous && !journal.hadBin)
    removeExpectedLink(join(root, 'bin'), 'bridge/bin', io);
  io.unlinkSync(path);
  syncDirectory(root, io);
}
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ESRCH') return false;
    throw error;
  }
}
function lock(root: string, io: InstallationFs) {
  // A bakery ticket avoids deleting somebody else's newly acquired lock while
  // recovering a dead installer. Dead tickets are ignored, never stolen.
  const folder = join(root, '.install-locks');
  directory(folder, io, true);
  const token = randomUUID();
  const path = join(folder, `l-${token}.json`);
  const record: InstallationTicket = {
    version: 1,
    pid: process.pid,
    host: hostname(),
    token,
    ticket: null,
  };
  const records = () => {
    const result: InstallationTicket[] = [];
    for (const file of io.readdirSync(folder)) {
      if (!/^l-[a-f\d-]{36}\.json$/.test(file)) continue;
      const item = join(folder, file);
      let value: unknown;
      try {
        regular(item, io);
        value = JSON.parse(io.readFileSync(item, 'utf8'));
      } catch (error) {
        if (errorCode(error) === 'ENOENT') continue;
        throw new Error('Uncertain installation ticket; inspect it before retrying.', {
          cause: error,
        });
      }
      if (
        !isRecord(value) ||
        value.version !== 1 ||
        value.host !== hostname() ||
        file !== `l-${value.token}.json` ||
        typeof value.pid !== 'number' ||
        !Number.isSafeInteger(value.pid) ||
        value.pid < 1 ||
        (value.ticket !== null &&
          (typeof value.ticket !== 'number' ||
            !Number.isSafeInteger(value.ticket) ||
            value.ticket < 1))
      )
        throw new Error('Uncertain installation ticket; inspect it before retrying.');
      if (alive(value.pid)) result.push(value as unknown as InstallationTicket);
    }
    return result;
  };
  atomicFile(path, JSON.stringify(record), 0o600, io);
  const release = () => {
    if (info(path, io)) io.unlinkSync(path);
  };
  try {
    const maximum = Math.max(0, ...records().map((value) => value.ticket ?? 0));
    if (!Number.isSafeInteger(maximum + 1)) throw new Error('Installation ticket range exhausted.');
    record.ticket = maximum + 1;
    atomicFile(path, JSON.stringify(record), 0o600, io);
    if (
      records().some(
        (value) =>
          value.token !== token &&
          (value.ticket === null ||
            value.ticket < record.ticket! ||
            (value.ticket === record.ticket && value.token < token)),
      )
    )
      throw new Error('Another helper installation is active. Retry after it exits.');
    return release;
  } catch (error) {
    release();
    throw error;
  }
}
function legacyProcesses(root: string) {
  const out = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  return out.split('\n').filter((line) => {
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    return (
      match &&
      Number(match[1]) !== process.pid &&
      (match[2].includes(join(root, 'bridge') + '/') || match[2].includes(join(root, 'bin') + '/'))
    );
  }).length;
}
function requireLegacyIdle(root: string, inspect: (root: string) => number) {
  let count;
  try {
    count = inspect(root);
    if (!Number.isSafeInteger(count) || count < 0)
      throw new Error('Invalid process inspection result.');
  } catch (error) {
    throw new Error(
      'Legacy helper activity is uncertain. Keep applications disconnected and resolve process inspection before migration.',
      { cause: error },
    );
  }
  if (count)
    throw new Error('Legacy helper processes are still active. Disconnect them before migration.');
}

function verifySyntax(path: string, node: string, io: InstallationFs) {
  for (const file of safeFiles(path, io).filter((p) => p.endsWith('.mjs'))) {
    try {
      execFileSync(node, ['--check', join(path, file)], { stdio: 'pipe' });
    } catch {
      throw new Error(`Prepared helper module failed syntax verification: ${file}`);
    }
  }
}

function activate(
  root: string,
  name: string,
  previous: ActiveInstallation,
  registrations: RegistrationChange[],
  id: string,
  io: InstallationFs,
) {
  const journal = {
    version: 1,
    id,
    next: name,
    previous: previous?.generation ?? null,
    legacy: Boolean(previous?.legacy),
    hadBin: Boolean(info(join(root, 'bin'), io)),
    registrations,
  };
  atomicFile(join(root, '.install-transaction.json'), JSON.stringify(journal), 0o600, io);
  if (previous?.legacy) {
    const backup = join(root, `.legacy-${id}`);
    directory(backup, io, true);
    io.renameSync(join(root, 'bridge'), join(backup, 'bridge'));
    io.renameSync(join(root, 'bin'), join(backup, 'bin'));
  }
  if (!previous || previous.legacy) atomicLink(join(root, 'bin'), 'bridge/bin', io);
  for (const registration of registrations) {
    if (registration.after === null) {
      if (info(registration.path, io)) io.unlinkSync(registration.path);
    } else atomicFile(registration.path, Buffer.from(registration.after, 'base64'), 0o600, io);
  }
  atomicLink(join(root, 'bridge'), `generations/${name}`, io);
  io.unlinkSync(join(root, '.install-transaction.json'));
}

/** One installation transaction; the filesystem and process inspection seams are local test adapters. */
export async function installHelpers(
  options: InstallOptions,
  {
    source = sourceRoot,
    jose,
    node = process.execPath,
    environment = process.env,
    filesystem: io = fs,
    inspectLegacyProcesses = legacyProcesses,
    verify = verifySyntax,
  }: InstallDependencies = {},
) {
  const components = [...new Set(options.components ?? [options.chatgpt ? 'chatgpt' : 'tabs'])];
  if (!components.length || components.some((c) => !entries[c]))
    throw new Error('Choose helper components: tabs,chatgpt.');
  // Validate plans before creating an installation directory.
  components.forEach((component) =>
    installationPlan({ ...options, chatgpt: component === 'chatgpt' }),
  );
  const root = canonicalRoot(options.installDir ?? join(options.home ?? homedir(), '.saul'), io);
  const release = lock(root, io);
  let journalWritten = false;
  try {
    recover(root, io);
    const previous = active(root, io);
    if (previous?.legacy) {
      directory(join(root, 'bin'), io);
      const installed = Object.keys(entries).filter((component) =>
        info(join(root, 'bridge', entries[component][0]), io),
      );
      if (!installed.length || installed.some((c) => !components.includes(c)))
        throw new Error(
          `Legacy migration must select all installed helpers: ${installed.join(',') || 'installation is incomplete'}.`,
        );
      if (!options.migrateLegacy)
        throw new Error(
          'Legacy helpers require a one-time maintenance window. Disconnect both native connections and the Saul MCP connection, then retry with --migrate-legacy.',
        );
      requireLegacyIdle(root, inspectLegacyProcesses);
    } else if (!previous && info(join(root, 'bin'), io))
      throw new Error('Unmanaged launcher directory; refusing to replace it.');
    const helpers: Record<string, HelperConfiguration> = structuredClone(previous?.helpers ?? {});
    for (const component of components) {
      const plan = installationPlan({
        ...options,
        installDir: root,
        chatgpt: component === 'chatgpt',
      });
      directory(dirname(plan.manifestPath), io, true);
      const before = snapshot(plan.manifestPath, io);
      if (before) {
        let existing;
        try {
          existing = JSON.parse(Buffer.from(before.data, 'base64').toString('utf8'));
        } catch {
          throw new Error('Invalid existing native host registration.');
        }
        const existingLocation = resolve(
          dirname(existing.path ?? ''),
          basename(existing.path ?? ''),
        );
        const canonicalLocation = info(dirname(existingLocation), io)
          ? join(io.realpathSync(dirname(existingLocation)), basename(existingLocation))
          : existingLocation;
        const expectedLocation = info(dirname(plan.manifest.path), io)
          ? join(io.realpathSync(dirname(plan.manifest.path)), basename(plan.manifest.path))
          : plan.manifest.path;
        if (
          existing.name !== plan.manifest.name ||
          canonicalLocation !== expectedLocation ||
          existing.type !== 'stdio' ||
          !Array.isArray(existing.allowed_origins) ||
          existing.allowed_origins.some(
            (v: unknown) => typeof v !== 'string' || !/^chrome-extension:\/\/[a-p]{32}\/$/.test(v),
          )
        )
          throw new Error(
            'Existing host registration belongs to another installation; refusing to overwrite.',
          );
        plan.manifest.allowed_origins = [
          ...new Set([...existing.allowed_origins, ...plan.manifest.allowed_origins]),
        ];
      }
      helpers[component] = {
        node: resolve(node),
        proxy:
          component === 'chatgpt'
            ? Object.fromEntries(
                proxyKeys.filter((key) => environment[key]).map((key) => [key, environment[key]!]),
              )
            : {},
        manifestPath: plan.manifestPath,
        manifest: plan.manifest,
      };
    }
    const id = randomUUID(),
      name = `g-${id}`;
    directory(join(root, 'generations'), io, true);
    const staging = join(root, 'generations', `.stage-${id}`);
    const generation = join(root, 'generations', name);
    directory(staging, io, true);
    for (const [component, config] of Object.entries(helpers)) {
      const payload = join(staging, component);
      directory(payload, io, true);
      if (components.includes(component)) {
        for (const file of payloadFiles[component]) {
          directory(source, io);
          let parent = source;
          for (const segment of file.split('/').slice(0, -1)) {
            parent = join(parent, segment);
            directory(parent, io);
          }
          copyTree(join(source, file), join(payload, file), io);
        }
        if (component === 'chatgpt') {
          const dependency =
            jose ?? dirname(fileURLToPath(import.meta.resolve('jose/package.json')));
          copyTree(io.realpathSync(dependency), join(payload, 'node_modules', 'jose'), io);
          writeFile(
            join(payload, 'installation-root.json'),
            JSON.stringify({ version: 1, root }),
            0o600,
            io,
          );
        }
      } else {
        for (const file of safeFiles(join(previous!.path!, component), io))
          copyTree(join(previous!.path!, component, file), join(payload, file), io);
      }
      await verify(payload, config.node, io);
      for (const entry of entries[component])
        writeFile(
          join(staging, entry),
          `// Stable installed entry; imports are pinned to this generation.\nawait import('./${component}/${entry}');\n`,
          0o600,
          io,
        );
      directory(join(staging, 'bin'), io, true);
      for (const [command, entry] of component === 'tabs'
        ? [
            ['saul-native-host', 'host.mjs'],
            ['saul', 'cli.mjs'],
          ]
        : [['saul-chatgpt-host', 'plan-host.mjs']]) {
        const proxy = Object.entries(config.proxy)
          .map(([key, value]) => `export ${key}=${shellQuote(value)}\n`)
          .join('');
        writeFile(
          join(staging, 'bin', command),
          `#!/bin/sh\n${proxy}exec ${shellQuote(config.node)} ${component === 'chatgpt' ? '--use-env-proxy ' : ''}${shellQuote(join(generation, entry))} "$@"\n`,
          0o700,
          io,
        );
      }
    }
    const files = Object.fromEntries(
      safeFiles(staging, io).map((file) => [file, hash(io.readFileSync(join(staging, file)))]),
    );
    writeFile(
      join(staging, 'installation.json'),
      JSON.stringify(
        {
          version: 1,
          root,
          generation: name,
          previous: previous?.generation ?? null,
          helpers,
          files,
        },
        null,
        2,
      ) + '\n',
      0o600,
      io,
    );
    io.renameSync(staging, generation);
    syncDirectory(join(root, 'generations'), io);
    receipt(root, name, io);
    if (previous?.legacy) requireLegacyIdle(root, inspectLegacyProcesses);
    const registrations = components.map((component) => {
      const value = helpers[component];
      return {
        path: value.manifestPath,
        before: snapshot(value.manifestPath, io),
        after: Buffer.from(JSON.stringify(value.manifest, null, 2) + '\n').toString('base64'),
      };
    });
    journalWritten = true;
    activate(root, name, previous, registrations, id, io);
    journalWritten = false;
    return {
      root,
      generation: name,
      previous: previous?.generation ?? null,
      components,
      legacyBackup: previous?.legacy ? `.legacy-${id}` : null,
    };
  } catch (error) {
    if (journalWritten) {
      try {
        recover(root, io);
      } catch (recoveryError) {
        throw new AggregateError(
          [error, recoveryError],
          `Installation failed; recovery is pending. ${errorMessage(recoveryError)}`,
          { cause: recoveryError },
        );
      }
    }
    throw error;
  } finally {
    release();
  }
}

export function verifyInstallation(
  installDir: string,
  component: Component,
  { filesystem: io = fs } = {},
) {
  const value = info(resolve(installDir), io);
  if (!value?.isDirectory() || value.isSymbolicLink())
    throw new Error('Invalid installation root.');
  const root = io.realpathSync(resolve(installDir));
  if (info(join(root, '.install-transaction.json'), io))
    throw new Error('Installation recovery is pending; rerun the installer before verification.');
  const selected = active(root, io);
  if (!selected) throw new Error('Helper runtime is not installed.');
  if (selected.legacy) {
    if (!entries[component]) throw new Error(`Unknown helper: ${component}`);
    directory(join(root, 'bin'), io);
    regular(join(root, 'bin', component === 'tabs' ? 'saul-native-host' : 'saul-chatgpt-host'), io);
    regular(join(root, 'bridge', entries[component][0]), io);
    return { legacy: true as const, generation: null, previous: null };
  }
  const helper = selected.helpers[component];
  if (!helper) throw new Error(`Helper is not installed: ${component}`);
  const registered = JSON.parse(io.readFileSync(helper.manifestPath, 'utf8'));
  if (JSON.stringify(registered) !== JSON.stringify(helper.manifest))
    throw new Error(`Host registration mismatch: ${component}`);
  return { generation: selected.generation, previous: selected.previous, helper };
}

/** Explicit recovery selects a retained, verified generation; runtime failures never call this. */
export function restoreGeneration(
  installDir: string,
  generation: string,
  { filesystem: io = fs } = {},
) {
  const root = canonicalRoot(installDir, io);
  const release = lock(root, io);
  try {
    recover(root, io);
    const current = active(root, io);
    if (!current || current.legacy)
      throw new Error('Explicit generation recovery requires a managed installation.');
    const target = receipt(root, generation, io);
    if (current.generation === target.generation)
      return { root, generation, previous: current.previous };
    const paths = new Set(
      [...Object.values(current.helpers), ...Object.values(target.helpers)].map(
        (h) => h.manifestPath,
      ),
    );
    const registrations = [];
    for (const path of paths) {
      directory(dirname(path), io);
      const expected = Object.values(current.helpers).find((h) => h.manifestPath === path);
      const desired = Object.values(target.helpers).find((h) => h.manifestPath === path);
      const before = snapshot(path, io);
      const encode = (helper: HelperConfiguration | undefined) =>
        helper
          ? Buffer.from(JSON.stringify(helper.manifest, null, 2) + '\n').toString('base64')
          : null;
      if (before && before.data !== encode(expected) && before.data !== encode(desired))
        throw new Error('Host registration changed; refusing to overwrite it during recovery.');
      registrations.push({ path, before, after: encode(desired) });
    }
    try {
      activate(root, generation, current, registrations, randomUUID(), io);
    } catch (error) {
      try {
        recover(root, io);
      } catch (recoveryError) {
        throw new AggregateError(
          [error, recoveryError],
          `Recovery is pending: ${errorMessage(recoveryError)}`,
          { cause: recoveryError },
        );
      }
      throw error;
    }
    return { root, generation, previous: current.generation };
  } finally {
    release();
  }
}
