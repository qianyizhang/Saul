#!/usr/bin/env node
import { errorCode } from '../apps/saul/native/value.mts';
import { errorMessage } from '../apps/saul/native/transport.mts';
import { spawn } from 'node:child_process';
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { installationPlan, verifyInstallation } from '../apps/saul/native/installation.mts';

interface SetupOptions {
  components?: string;
  prepare?: boolean;
  skipBuild?: boolean;
  verify?: boolean;
  codex?: boolean;
  migrateLegacy?: boolean;
  extensionId?: string;
  installDir?: string;
  extensionDir?: string;
  manifestDir?: string;
  applicationsDir?: string;
  dryRun?: boolean;
}
type Command = { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv };

const root = fileURLToPath(new URL('../', import.meta.url));
const choices = ['extension', 'chatgpt', 'tabs', 'actions', 'ez'];
export const help = `Selective setup (run from any directory)

  node scripts/setup.mts --components extension --dry-run
  node scripts/setup.mts --components extension,chatgpt --extension-id ID
  node scripts/setup.mts --components ez
  node scripts/setup.mts --components extension,chatgpt,tabs,ez --extension-id ID

Components:
  extension  Chrome extension; API-provider reading and local history work alone
  chatgpt    Optional Node helper for ChatGPT sign-in, inference and summaries
  tabs       Optional Node helper for external tab tools and native window names
  actions    Optional Node helper for custom Summarize actions
  ez         Independent native macOS app (no Node runtime dependency)

Options:
  --dry-run                Show the complete plan without checks or writes
  --prepare                Install build dependencies and build selected artifacts only
  --skip-build             Install already prepared artifacts
  --verify                 Check installed artifacts only; no writes or live inference
  --extension-id ID         Actual 32-letter ID from chrome://extensions (helpers)
  --extension-dir DIR       Stable unpacked extension directory (defaults to ~/.saul/extension)
  --install-dir DIR         Helper installation root (defaults to ~/.saul)
  --manifest-dir DIR        Chrome NativeMessagingHosts override
  --applications-dir DIR    EZ installation directory (defaults to ~/Applications)
  --codex                   Explicitly register the tabs helper with Codex
  --migrate-legacy          Confirm the one-time disconnected helper migration window

Chrome loading/reloading remains a user action. --codex requires tabs.
Node 24/pinned pnpm build browser artifacts; Apple tools build EZ.
EZ installation requires its existing pinned signing identity; see docs/setup.md.
No credential migration, automatic sign-in, app launch, or background sync.`;

export function createPlan(
  options: SetupOptions,
  {
    repo = root,
    home = homedir(),
    platform = process.platform,
    node = process.execPath,
  }: { repo?: string; home?: string; platform?: string; node?: string } = {},
) {
  const components = [
    ...new Set(
      (options.components ?? '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
  if (!components.length || components.some((v) => !choices.includes(v)))
    throw new Error(`Select --components from ${choices.join(',')}.`);
  if (
    options.prepare &&
    (options.skipBuild || options.verify || options.codex || options.migrateLegacy)
  )
    throw new Error(
      '--prepare cannot combine with --skip-build, --verify, --codex or --migrate-legacy.',
    );
  if (options.verify && (options.skipBuild || options.codex || options.migrateLegacy))
    throw new Error('--verify cannot combine with --skip-build, --codex or --migrate-legacy.');
  if (options.migrateLegacy && !components.some((v) => ['tabs', 'chatgpt', 'actions'].includes(v)))
    throw new Error('--migrate-legacy requires a helper component.');
  if (options.codex && !components.includes('tabs'))
    throw new Error('--codex requires the tabs component.');
  if (components.includes('ez') && platform !== 'darwin')
    throw new Error('EZ requires macOS; select browser components on this platform.');
  const hasHelper = components.some((v) => ['chatgpt', 'tabs', 'actions'].includes(v));
  if (hasHelper && !options.prepare && !/^[a-p]{32}$/.test(options.extensionId ?? ''))
    throw new Error(
      'Helpers need --extension-id from chrome://extensions. Prepare/load the extension first.',
    );
  const browser = join(repo, 'apps/saul');
  const native = join(repo, 'apps/ez');
  const helperRoot = resolve(options.installDir ?? join(home, '.saul'));
  const extensionDir = resolve(options.extensionDir ?? join(helperRoot, 'extension'));
  // Refuse targets that would replace source, home, or the helper runtime tree.
  for (const protectedPath of [
    repo,
    home,
    helperRoot,
    join(helperRoot, 'bridge'),
    join(helperRoot, 'bin'),
    join(browser, '.output/chrome-mv3'),
  ]) {
    if (protectedPath === extensionDir || protectedPath.startsWith(extensionDir + '/'))
      throw new Error(
        'Extension destination must be a dedicated directory outside source and helper runtime.',
      );
  }
  const applicationsDir = resolve(options.applicationsDir ?? join(home, 'Applications'));
  const hosts = components
    .filter((v) => ['chatgpt', 'tabs', 'actions'].includes(v))
    .map((component) => ({
      ...installationPlan({
        extensionId: options.extensionId ?? 'a'.repeat(32),
        installDir: helperRoot,
        manifestDir: options.manifestDir,
        platform,
        home,
        chatgpt: component === 'chatgpt',
        component: component as 'tabs' | 'chatgpt' | 'actions',
      }),
    }));
  const commands: Command[] = [];
  const add = (command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}) =>
    commands.push({ command, args, cwd, env });
  if (!options.verify) {
    if (!options.skipBuild && components.some((v) => v !== 'ez'))
      add('pnpm', ['install', '--frozen-lockfile'], repo);
    if (!options.skipBuild && components.includes('extension')) add('pnpm', ['build'], browser);
    else if (!options.skipBuild && hasHelper) add('pnpm', ['build:native'], browser);
    if (components.includes('ez')) {
      if (options.prepare) add('make', ['app'], native);
      else {
        if (options.skipBuild)
          throw new Error(
            'EZ uses its verified build/install transaction; --skip-build is for browser components only.',
          );
        add('make', ['install'], native, { EZ_APPLICATIONS_DIR: applicationsDir });
      }
    }
    if (!options.prepare) {
      if (hosts.length)
        add(
          node,
          [
            join(browser, '.build/native/install.mjs'),
            '--extension-id',
            options.extensionId!,
            '--install-dir',
            helperRoot,
            '--manifest-dir',
            dirname(hosts[0].manifestPath),
            '--components',
            hosts.map((host) => host.component).join(','),
            ...(options.migrateLegacy ? ['--migrate-legacy'] : []),
          ],
          browser,
        );
      if (options.codex)
        add(
          'codex',
          ['mcp', 'add', 'saul-tabs', '--', node, join(helperRoot, 'bridge/mcp.mjs')],
          repo,
        );
    }
  }
  return {
    mode: options.verify ? 'verify' : options.prepare ? 'prepare' : 'install',
    components,
    repo,
    browser,
    native,
    node,
    commands,
    hosts,
    extensionDir,
    extensionSource: join(browser, '.output/chrome-mv3'),
    app: join(applicationsDir, 'EZ.app'),
    codex: Boolean(options.codex),
  };
}

export function runCommand(
  command: string,
  args: string[],
  {
    cwd,
    env = {},
    capture = false,
  }: { cwd?: string; env?: NodeJS.ProcessEnv; capture?: boolean } = {},
): Promise<string> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: false,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let out = '';
    let err = '';
    child.stdout?.on('data', (value) => {
      out += value;
    });
    child.stderr?.on('data', (value) => {
      err += value;
    });
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0
        ? resolveResult(out.trim())
        : reject(new Error(`${command} failed (${code}). ${err.trim()}`)),
    );
  });
}

export async function installExtension(source: string, destination: string) {
  const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
  if (manifest.manifest_version !== 3)
    throw new Error('Prepared artifact is not a Chrome MV3 extension.');
  try {
    await lstat(destination);
    throw new Error(
      'Extension destination already exists. Keep the loaded path and upgrade it explicitly; setup refuses to replace profile-linked artifacts.',
    );
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
  await mkdir(dirname(destination), { recursive: true });
  const staging = await mkdtemp(join(dirname(destination), '.extension-'));
  try {
    await cp(source, join(staging, 'bundle'), { recursive: true, errorOnExist: true });
    // Recheck before rename; never knowingly replace an existing installation.
    try {
      await lstat(destination);
      throw new Error('Extension destination appeared during setup.');
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
    }
    await rename(join(staging, 'bundle'), destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function executePlan(
  plan: ReturnType<typeof createPlan>,
  { run = runCommand, log = console.log } = {},
) {
  if (plan.mode === 'verify') {
    if (plan.components.includes('extension')) {
      const manifest = JSON.parse(await readFile(join(plan.extensionDir, 'manifest.json'), 'utf8'));
      if (manifest.manifest_version !== 3)
        throw new Error('Installed extension manifest is invalid.');
    }
    let legacyHelpers = false;
    for (const host of plan.hosts) {
      const manifest = JSON.parse(await readFile(host.manifestPath, 'utf8'));
      if (
        manifest.name !== host.manifest.name ||
        !manifest.allowed_origins?.includes(host.manifest.allowed_origins[0])
      )
        throw new Error(`Host registration mismatch: ${host.component}`);
      if ((await realpath(manifest.path)) !== (await realpath(host.manifest.path)))
        throw new Error(`Host registration mismatch: ${host.component}`);
      if (verifyInstallation(host.root, host.component as 'tabs' | 'chatgpt' | 'actions').legacy)
        legacyHelpers = true;
    }
    if (plan.components.includes('ez'))
      await run('codesign', ['--verify', '--strict', plan.app], { cwd: plan.native });
    if (legacyHelpers)
      log('Legacy helper files checked; generation integrity requires the explicit migration.');
    log(
      'Installed artifact checks passed. Browser connection, live OAuth/inference and running app versions were not tested.',
    );
    return;
  }
  // Check prerequisites before the first installation action.
  if (plan.mode === 'install' && plan.components.includes('extension')) {
    try {
      await lstat(plan.extensionDir);
      throw new Error(
        'Extension destination already exists. Preserve the loaded path; setup will not replace it.',
      );
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
    }
  }
  if (plan.components.some((v) => v !== 'ez')) {
    const version = await run(plan.node, ['--version'], { capture: true });
    if (!version.startsWith('v24.')) throw new Error(`Use Node 24; found ${version}.`);
    if (plan.commands.some((c) => c.command === 'pnpm')) {
      const pkg = JSON.parse(await readFile(join(plan.repo, 'package.json'), 'utf8'));
      const pnpm = await run('pnpm', ['--version'], { capture: true });
      if (`pnpm@${pnpm}` !== pkg.packageManager)
        throw new Error(`Use ${pkg.packageManager}; found pnpm ${pnpm}.`);
    }
  }
  if (plan.components.includes('ez')) {
    await run('xcrun', ['--find', 'swift'], { capture: true });
    if (plan.mode === 'install') await access(join(plan.native, '.local/signing-identity'));
  }
  if (plan.codex) {
    const registrations = JSON.parse(
      await run('codex', ['mcp', 'list', '--json'], { capture: true }),
    );
    if (registrations.some((item: { name?: string }) => item.name === 'saul-tabs'))
      throw new Error(
        'saul-tabs is already registered. Omit --codex to preserve it; inspect it explicitly before changing registration.',
      );
  }
  for (const { command, args, cwd, env } of plan.commands) await run(command, args, { cwd, env });
  if (plan.components.includes('extension')) {
    if (plan.mode === 'install') await installExtension(plan.extensionSource, plan.extensionDir);
    log(
      `Extension prepared at ${plan.mode === 'install' ? plan.extensionDir : plan.extensionSource}. Load it explicitly in chrome://extensions. Existing profiles and extensions were not changed.`,
    );
  }
  if (plan.hosts.length && plan.mode === 'install')
    log(
      'Helpers installed. Enable the selected connection in Saul Settings. Helpers use the installation-time Node executable.',
    );
  if (plan.mode === 'prepare') log('Preparation complete; nothing was installed or registered.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let prompt;
  try {
    const { values } = parseArgs({
      options: {
        components: { type: 'string' },
        'extension-id': { type: 'string' },
        'extension-dir': { type: 'string' },
        'install-dir': { type: 'string' },
        'manifest-dir': { type: 'string' },
        'applications-dir': { type: 'string' },
        'dry-run': { type: 'boolean' },
        prepare: { type: 'boolean' },
        'skip-build': { type: 'boolean' },
        verify: { type: 'boolean' },
        codex: { type: 'boolean' },
        'migrate-legacy': { type: 'boolean' },
        help: { type: 'boolean' },
      },
    });
    if (values.help) console.log(help);
    else {
      if (!values.components && process.stdin.isTTY && process.stdout.isTTY) {
        console.log(help);
        prompt = createInterface({ input: process.stdin, output: process.stdout });
        values.components = await prompt.question('Components (comma-separated): ');
      }
      const options = Object.fromEntries(
        Object.entries(values).map(([key, value]) => [
          key.replace(/-([a-z])/g, (_, c) => c.toUpperCase()),
          value,
        ]),
      );
      const plan = createPlan(options);
      if (options.dryRun) console.log(JSON.stringify(plan, null, 2));
      else await executePlan(plan);
    }
  } catch (error) {
    console.error(`Setup stopped: ${errorMessage(error)}`);
    process.exitCode = 1;
  } finally {
    prompt?.close();
  }
}
