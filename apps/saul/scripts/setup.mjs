#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { createInterface as readLines } from 'node:readline';
import { installationPlan } from '../native/install.mjs';
import { APP_URI, MCP_TOOLS } from '../native/app-protocol.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const help = `Saul setup (macOS/Linux, Google Chrome)

  node scripts/setup.mjs                     Interactive build/install/connect wizard
  node scripts/setup.mjs --extension-id ID   Install using a known Chrome extension ID
  node scripts/setup.mjs --prepare           Install dependencies and build only
  node scripts/setup.mjs --verify            Read-only MCP and browser connection check
  node scripts/setup.mjs --dry-run           Show steps without running or writing anything

Options: --skip-build (reuse a prepared bundle), --install-dir DIR,
         --manifest-dir DIR, --extension-id ID, --help
Prerequisites: Node 24, the package.json pnpm version, Chrome and Codex CLI on PATH.
Exit codes: 0 ready/prepared, 1 error, 2 browser or user action still needed.
No sudo, startup daemon, browser-profile edits, or automatic access toggles.`;

export function runCommand(command, args, { cwd = root, capture = false } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let stdout = '',
      stderr = '';
    child.stdout?.on('data', (data) => {
      stdout += data;
    });
    child.stderr?.on('data', (data) => {
      stderr += data;
    });
    child.once('error', (error) => reject(new Error(`Cannot run ${command}: ${error.message}`)));
    child.once('close', (code) => {
      if (code !== 0)
        reject(
          new Error(
            `${command} ${args.slice(0, 2).join(' ')} failed (${code}).${capture ? ' ' + stderr.trim() : ''}`,
          ),
        );
      else resolveResult(stdout.trim());
    });
  });
}

// Verify the command actually registered with Codex, including its environment/cwd.
// Return counts only: do not print or persist the user's titles, URLs or page text.
export async function verifyMcp(transport, extensionId) {
  const child = spawn(transport.command, transport.args ?? [], {
    cwd: transport.cwd || root,
    env: { ...process.env, ...transport.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });
  const pending = new Map();
  let nextId = 0;
  let failure;
  const fail = (error) => {
    failure = error;
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  };
  child.on('error', fail);
  child.on('exit', () => fail(new Error('MCP process exited before verification completed')));
  child.stdin.on('error', fail);
  child.stderr.resume();
  const lines = readLines({ input: child.stdout });
  lines.on('line', (line) => {
    try {
      const response = JSON.parse(line);
      const item = pending.get(response.id);
      if (!item) return;
      clearTimeout(item.timer);
      pending.delete(response.id);
      if (response.error) item.reject(new Error(response.error.message));
      else item.resolve(response.result);
    } catch {
      fail(new Error('MCP returned invalid JSON'));
    }
  });
  const rpc = (method, params = {}) =>
    new Promise((resolveResult, reject) => {
      if (failure) {
        reject(failure);
        return;
      }
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP ${method} timed out; no browser mutation was requested`));
      }, 10000);
      pending.set(id, { resolve: resolveResult, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  const call = async (name, args = {}) => {
    const result = await rpc('tools/call', { name, arguments: args });
    if (result.isError) throw new Error(result.content?.[0]?.text || 'MCP tool failed');
    return JSON.parse(result.content[0].text);
  };
  try {
    const initialized = await rpc('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'saul-setup', version: '1' },
    });
    child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
    );
    const { tools } = await rpc('tools/list');
    const expected = MCP_TOOLS.map((tool) => tool.name).sort();
    if (JSON.stringify(tools.map((tool) => tool.name).sort()) !== JSON.stringify(expected))
      throw new Error('Installed MCP tools differ from this checkout; run setup again');
    const { contents } = await rpc('resources/read', { uri: APP_URI });
    const app = contents?.find((item) => item.uri === APP_URI);
    if (app?.mimeType !== 'text/html;profile=mcp-app' || !app.text?.includes('ui/initialize'))
      throw new Error('Installed MCP App resource is missing or invalid; run setup again');
    const { sessions } = await call('saul_sessions');
    const selected = sessions.filter(
      (session) => !extensionId || session.extensionId === extensionId,
    );
    const inventories = [];
    for (const session of selected) {
      const before = performance.now();
      const inventory = await call('saul_tabs_list', { session: session.session });
      inventories.push({
        session: session.session,
        extensionId: session.extensionId,
        tabs: inventory.tabs.length,
        windows: inventory.windows.length,
        elapsedMs: Math.round(performance.now() - before),
      });
    }
    return {
      status: selected.length ? 'ready' : 'waiting-for-browser',
      server: initialized.serverInfo,
      toolCount: tools.length,
      appResource: APP_URI,
      inventories,
    };
  } finally {
    for (const item of pending.values()) clearTimeout(item.timer);
    pending.clear();
    lines.close();
    child.kill();
  }
}

export async function setup(options = {}, dependencies = {}) {
  const run = dependencies.run ?? runCommand;
  const log = dependencies.log ?? console.log;
  const ask = dependencies.ask;
  const verify = dependencies.verify ?? verifyMcp;
  const repo = dependencies.root ?? root;
  const node = dependencies.node ?? process.execPath;
  const nodeVersion = dependencies.nodeVersion ?? process.versions.node;
  const pkg = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
  const bundle = join(repo, '.output/chrome-mv3');
  if (options.prepare && (options.verify || options.skipBuild || options.extensionId))
    throw new Error('--prepare cannot be combined with --verify, --skip-build or --extension-id');
  if (options.verify && (options.prepare || options.skipBuild))
    throw new Error('--verify cannot be combined with --prepare or --skip-build');
  if (options.extensionId && !/^[a-p]{32}$/.test(options.extensionId))
    throw new Error('Extension ID must be the actual 32-letter ID from chrome://extensions');
  const plan = installationPlan({
    extensionId: options.extensionId ?? 'a'.repeat(32),
    installDir: options.installDir,
    manifestDir: options.manifestDir,
  });
  const mcpPath = join(plan.runtime, 'mcp.mjs');
  if (options.dryRun) {
    log(
      JSON.stringify(
        {
          mode: options.verify ? 'verify' : options.prepare ? 'prepare' : 'install',
          build: !options.verify && !options.skipBuild,
          bundle,
          extensionId: options.extensionId ?? 'prompt after loading extension',
          runtime: plan.runtime,
          manifest: plan.manifestPath,
          codexCommand: ['codex', 'mcp', 'add', 'saul-tabs', '--', node, mcpPath],
          browserChanges: 'none; load/reload and access switches are explicit',
          verification:
            'Fresh MCP process: handshake, tools, UI resource, sessions and tab counts; not the running Codex connection or panel',
        },
        null,
        2,
      ),
    );
    return { status: 'dry-run', exitCode: 0 };
  }
  if (Number(nodeVersion.split('.')[0]) !== 24)
    throw new Error(`Use Node 24 (see .node-version); current version is ${nodeVersion}`);
  let registration;
  if (!options.prepare) {
    const configured = JSON.parse(
      await run('codex', ['mcp', 'list', '--json'], { cwd: repo, capture: true }),
    );
    registration = configured.find((item) => item.name === 'saul-tabs');
    if (
      registration &&
      (registration.transport?.type !== 'stdio' ||
        registration.transport.args?.length !== 1 ||
        resolve(registration.transport.args[0]) !== mcpPath)
    )
      throw new Error(
        'Existing saul-tabs registration points elsewhere; refusing to replace it. Inspect codex mcp get saul-tabs.',
      );
    if (registration?.enabled === false)
      throw new Error(
        'saul-tabs is disabled in Codex; enable it explicitly before setup/verification',
      );
  }
  if (!options.verify && !options.skipBuild) {
    const version = await run('pnpm', ['--version'], { cwd: repo, capture: true });
    const expected = pkg.packageManager.replace('pnpm@', '');
    if (version !== expected)
      throw new Error(
        `Use pnpm ${expected}; found ${version}. Activate the packageManager version with Corepack.`,
      );
    log('Installing locked dependencies and building Saul…');
    await run('pnpm', ['install', '--frozen-lockfile'], { cwd: repo });
    await run('pnpm', ['build'], { cwd: repo });
  }
  if (!options.verify) {
    await access(join(bundle, 'manifest.json'));
    log(
      `Extension ready: ${bundle}\nIn chrome://extensions enable Developer mode, load this folder (or reload Saul), and copy its ID.`,
    );
    if (options.prepare) return { status: 'prepared', exitCode: 0, bundle };
    if (!options.extensionId && ask)
      options = { ...options, extensionId: (await ask('Saul extension ID: ')).trim() };
    if (!options.extensionId) {
      log(
        'Build prepared. Continue with: node scripts/setup.mjs --skip-build --extension-id YOUR_ID',
      );
      return { status: 'needs-extension-id', exitCode: 2, bundle };
    }
    installationPlan({ extensionId: options.extensionId }); // Validate prompt input before any install.
    const args = [join(repo, 'native/install.mjs'), '--extension-id', options.extensionId];
    if (options.installDir) args.push('--install-dir', options.installDir);
    if (options.manifestDir) args.push('--manifest-dir', options.manifestDir);
    log('Installing the native helper…');
    await run(node, args, { cwd: repo, capture: true });
    if (!registration) {
      await run('codex', ['mcp', 'add', 'saul-tabs', '--', node, mcpPath], {
        cwd: repo,
        capture: true,
      });
      registration = { transport: { type: 'stdio', command: node, args: [mcpPath] } };
    } else log('Keeping the existing matching Codex registration and its settings.');
    log(
      'Installed and registered. In Saul → Settings → Codex connection, enable Codex tab access and choose Reconnect. Enable Page reading and actions only if wanted.',
    );
    if (ask) await ask('Press Enter after Saul shows Connected to native host: ');
  }
  if (!registration) throw new Error('saul-tabs is not registered with Codex; run setup first');
  const result = await verify(registration.transport, options.extensionId);
  log(JSON.stringify(result, null, 2));
  if (result.status !== 'ready')
    log(
      'MCP is installed, but no matching browser is connected. Load/reload Saul, enable access, click Reconnect, then run node scripts/setup.mjs --verify.',
    );
  else
    log(
      'Verified UI resource and tab inventory in a fresh MCP process. The running Codex connection and panel were not tested. After an upgrade, fully quit and reopen Codex to replace older MCP processes, then reopen Saul. Page actions were not exercised.',
    );
  return { ...result, exitCode: result.status === 'ready' ? 0 : 2 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let prompt;
  try {
    const { values } = parseArgs({
      options: {
        'extension-id': { type: 'string' },
        'install-dir': { type: 'string' },
        'manifest-dir': { type: 'string' },
        'skip-build': { type: 'boolean' },
        prepare: { type: 'boolean' },
        verify: { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        help: { type: 'boolean' },
      },
    });
    if (values.help) console.log(help);
    else {
      if (
        process.stdin.isTTY &&
        process.stdout.isTTY &&
        !values['dry-run'] &&
        !values.verify &&
        !values.prepare
      )
        prompt = createInterface({ input: process.stdin, output: process.stdout });
      const result = await setup(
        {
          extensionId: values['extension-id'],
          installDir: values['install-dir'],
          manifestDir: values['manifest-dir'],
          skipBuild: values['skip-build'],
          prepare: values.prepare,
          verify: values.verify,
          dryRun: values['dry-run'],
        },
        { ask: prompt ? (question) => prompt.question(question) : undefined },
      );
      process.exitCode = result.exitCode;
    }
  } catch (error) {
    console.error(`Setup stopped: ${error.message}`);
    process.exitCode = 1;
  } finally {
    prompt?.close();
  }
}
