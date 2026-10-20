#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import { parseArgs, promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface as readLines } from 'node:readline';
import { APP_URI, MCP_TOOLS } from '../native/app-protocol.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const exec = promisify(execFile);
const listRegistrations = async () =>
  JSON.parse((await exec('codex', ['mcp', 'list', '--json'])).stdout);

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

export async function verifyConnection(
  extensionId,
  { list = listRegistrations, verify = verifyMcp } = {},
) {
  if (extensionId !== undefined && !/^[a-p]{32}$/.test(extensionId)) {
    throw new Error('Use the actual 32-letter extension ID from chrome://extensions.');
  }
  const registration = (await list()).find((item) => item.name === 'saul-tabs');
  if (!registration)
    throw new Error(
      'saul-tabs is not registered. Use the root selective installer with --components tabs --codex.',
    );
  if (registration.enabled === false)
    throw new Error('saul-tabs is disabled; enable it explicitly in Codex.');
  if (registration.transport?.type !== 'stdio' || !registration.transport.command) {
    throw new Error('saul-tabs must use a local stdio transport. Inspect codex mcp get saul-tabs.');
  }
  const result = await verify(registration.transport, extensionId);
  return { ...result, exitCode: result.status === 'ready' ? 0 : 2 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: { 'extension-id': { type: 'string' }, help: { type: 'boolean' } },
    });
    if (values.help)
      console.log(
        'Read-only connection check: node scripts/verify-connection.mjs [--extension-id ID]\nExit 0: connected; 2: waiting for browser; 1: error. No installation, registration or browser mutations.',
      );
    else {
      const result = await verifyConnection(values['extension-id']);
      console.log(JSON.stringify(result, null, 2));
      if (result.exitCode === 2)
        console.log(
          'No matching browser is connected. Enable access and Reconnect in Saul Settings.',
        );
      console.log(
        'Verified a fresh MCP process, not the running Codex panel. No page actions or live inference were exercised.',
      );
      process.exitCode = result.exitCode;
    }
  } catch (error) {
    console.error(`Connection check stopped: ${error.message}`);
    process.exitCode = 1;
  }
}
