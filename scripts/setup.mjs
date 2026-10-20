#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { access, cp, lstat, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { installationPlan } from '../apps/saul/native/install.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const choices = ['extension', 'chatgpt', 'tabs', 'ez'];
export const help = `Selective setup (run from any directory)

  node scripts/setup.mjs --components extension --dry-run
  node scripts/setup.mjs --components extension,chatgpt --extension-id ID
  node scripts/setup.mjs --components ez
  node scripts/setup.mjs --components extension,chatgpt,tabs,ez --extension-id ID

Components:
  extension  Chrome extension; API-provider reading and local history work alone
  chatgpt    Optional Node helper for ChatGPT sign-in, inference and summaries
  tabs       Optional Node helper for external tab tools and native window names
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

Chrome loading/reloading remains a user action. --codex requires tabs.
Node 24/pinned pnpm build browser artifacts; Apple tools build EZ.
EZ installation requires its existing pinned signing identity; see docs/setup.md.
No credential migration, automatic sign-in, app launch, or background sync.`;

export function createPlan(
  options,
  { repo = root, home = homedir(), platform = process.platform, node = process.execPath } = {},
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
  if (options.prepare && (options.skipBuild || options.verify || options.codex))
    throw new Error('--prepare cannot combine with --skip-build, --verify or --codex.');
  if (options.verify && (options.skipBuild || options.codex))
    throw new Error('--verify cannot combine with --skip-build or --codex.');
  if (options.codex && !components.includes('tabs'))
    throw new Error('--codex requires the tabs component.');
  if (components.includes('ez') && platform !== 'darwin')
    throw new Error('EZ requires macOS; select browser components on this platform.');
  const hasHelper = components.some((v) => ['chatgpt', 'tabs'].includes(v));
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
    .filter((v) => ['chatgpt', 'tabs'].includes(v))
    .map((component) => ({
      component,
      ...installationPlan({
        extensionId: options.extensionId ?? 'a'.repeat(32),
        installDir: helperRoot,
        manifestDir: options.manifestDir,
        platform,
        home,
        chatgpt: component === 'chatgpt',
      }),
    }));
  const commands = [];
  const add = (command, args, cwd, env = {}) => commands.push({ command, args, cwd, env });
  if (!options.verify) {
    if (!options.skipBuild && components.some((v) => v !== 'ez'))
      add('pnpm', ['install', '--frozen-lockfile'], repo);
    if (!options.skipBuild && components.includes('extension')) add('pnpm', ['build'], browser);
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
      for (const host of hosts)
        add(
          node,
          [
            join(browser, 'native/install.mjs'),
            '--extension-id',
            options.extensionId,
            '--install-dir',
            helperRoot,
            '--manifest-dir',
            dirname(host.manifestPath),
            ...(host.component === 'chatgpt' ? ['--chatgpt'] : []),
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

export function runCommand(command, args, { cwd, env = {}, capture = false } = {}) {
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

export async function installExtension(source, destination) {
  const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
  if (manifest.manifest_version !== 3)
    throw new Error('Prepared artifact is not a Chrome MV3 extension.');
  try {
    await lstat(destination);
    throw new Error(
      'Extension destination already exists. Keep the loaded path and upgrade it explicitly; setup refuses to replace profile-linked artifacts.',
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
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
      if (error.code !== 'ENOENT') throw error;
    }
    await rename(join(staging, 'bundle'), destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function executePlan(plan, { run = runCommand, log = console.log } = {}) {
  if (plan.mode === 'verify') {
    if (plan.components.includes('extension')) {
      const manifest = JSON.parse(await readFile(join(plan.extensionDir, 'manifest.json'), 'utf8'));
      if (manifest.manifest_version !== 3)
        throw new Error('Installed extension manifest is invalid.');
    }
    for (const host of plan.hosts) {
      const manifest = JSON.parse(await readFile(host.manifestPath, 'utf8'));
      if (
        manifest.name !== host.manifest.name ||
        manifest.path !== host.manifest.path ||
        !manifest.allowed_origins?.includes(host.manifest.allowed_origins[0])
      )
        throw new Error(`Host registration mismatch: ${host.component}`);
      await access(manifest.path);
      await access(join(host.runtime, host.component === 'chatgpt' ? 'plan-host.mjs' : 'host.mjs'));
    }
    if (plan.components.includes('ez'))
      await run('codesign', ['--verify', '--strict', plan.app], { cwd: plan.native });
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
      if (error.code !== 'ENOENT') throw error;
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
    if (registrations.some((item) => item.name === 'saul-tabs'))
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
      options: Object.fromEntries([
        ...[
          'components',
          'extension-id',
          'extension-dir',
          'install-dir',
          'manifest-dir',
          'applications-dir',
        ].map((key) => [key, { type: 'string' }]),
        ...['dry-run', 'prepare', 'skip-build', 'verify', 'codex', 'help'].map((key) => [
          key,
          { type: 'boolean' },
        ]),
      ]),
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
    console.error(`Setup stopped: ${error.message}`);
    process.exitCode = 1;
  } finally {
    prompt?.close();
  }
}
