import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { endianness } from 'node:os';
import { encodeNative, nativeDecoder, lineDecoder } from '../native/transport.mjs';
import { callTool, sessions } from '../native/client.mjs';
import { installationPlan } from '../native/install.mjs';

let directory;
const children = [];
beforeEach(() => {
  directory = mkdtempSync('/tmp/saul-test-');
  vi.stubEnv('SAUL_RUNTIME_DIR', join(directory, 'run'));
});
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit');
      child.kill();
      await stopped;
    }
  }
  vi.unstubAllEnvs();
  rmSync(directory, { force: true, recursive: true });
});
async function host(
  respond = (message) => ({ result: { echoed: message.params, method: message.method } }),
) {
  const child = spawn(
    process.execPath,
    ['native/host.mjs', `chrome-extension://${'a'.repeat(32)}/`],
    { cwd: resolve('.'), env: process.env },
  );
  children.push(child);
  let stderr = '';
  child.stderr.on('data', (data) => {
    stderr += data;
  });
  await new Promise((resolve, reject) => {
    const decode = nativeDecoder((message) => {
      if (message.type === 'ready') {
        resolve();
        return;
      }
      const response = respond(message);
      if (response) child.stdin.write(encodeNative({ id: message.id, ...response }));
    });
    child.stdout.on('data', (chunk) => {
      try {
        decode(chunk);
      } catch (error) {
        reject(error);
      }
    });
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`Host exited ${code}: ${stderr}`)));
  });
  return child;
}
async function subprocess(script, args = [], input) {
  const child = spawn(process.execPath, [script, ...args], { env: process.env });
  children.push(child);
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (data) => {
    stdout += data;
  });
  child.stderr.on('data', (data) => {
    stderr += data;
  });
  const exited = once(child, 'exit');
  child.stdin.end(input);
  const [code] = await exited;
  return { code, stdout, stderr };
}

describe('native transport', () => {
  it('decodes fragmented and concatenated UTF-8 native frames', () => {
    const values = [];
    const decode = nativeDecoder((value) => values.push(value));
    const bytes = Buffer.concat([encodeNative({ text: '研究 🚀' }), encodeNative({ id: 2 })]);
    for (const byte of bytes) decode(Buffer.from([byte]));
    expect(values).toEqual([{ text: '研究 🚀' }, { id: 2 }]);
  });
  it('rejects malformed lengths and handles UTF-8 split over socket chunks', () => {
    const header = Buffer.alloc(4);
    header[endianness() === 'LE' ? 'writeUInt32LE' : 'writeUInt32BE'](1024 * 1024 + 1);
    expect(() => nativeDecoder(() => {})(header)).toThrow('length');
    expect(() => encodeNative({ text: 'x'.repeat(1024 * 1024) })).toThrow('1 MiB');
    const values = [];
    const decode = lineDecoder((value) => values.push(value));
    for (const byte of Buffer.from('{"title":"研究"}\n')) decode(Buffer.from([byte]));
    expect(values).toEqual([{ title: '研究' }]);
  });
  it('reports a useful offline error', async () => {
    expect(await sessions()).toEqual([]);
    await expect(callTool('saul_tabs_list')).rejects.toThrow('No Saul browser connected');
  });
  it('round trips through a real host process and private socket, correlating concurrent clients', async () => {
    await host();
    const active = await sessions();
    expect(active).toHaveLength(1);
    expect(statSync(process.env.SAUL_RUNTIME_DIR).mode & 0o777).toBe(0o700);
    expect(
      statSync(join(process.env.SAUL_RUNTIME_DIR, `${active[0].session}.sock`)).mode & 0o777,
    ).toBe(0o600);
    const results = await Promise.all([
      callTool('saul_tabs_list', { windowId: 1 }),
      callTool('saul_tabs_list', { windowId: 2 }),
    ]);
    expect(results.map((r) => r.echoed.windowId)).toEqual([1, 2]);
  });
  it('requires explicit selection when multiple profiles are connected', async () => {
    await host();
    await host();
    await expect(callTool('saul_tabs_list')).rejects.toThrow('Multiple browsers/profiles');
    const active = await sessions();
    expect(await callTool('saul_tabs_list', { session: active[0].session })).toMatchObject({
      echoed: {},
    });
  });
  it('propagates browser errors without reporting success', async () => {
    await host(() => ({ error: { message: 'Tab was closed' } }));
    await expect(callTool('saul_tabs_group', { tabIds: [123], dryRun: false })).rejects.toThrow(
      'Tab was closed',
    );
  });
  it('rejects pending calls and removes its socket when Chrome disconnects', async () => {
    let received;
    const incoming = new Promise((resolve) => {
      received = resolve;
    });
    const child = await host(() => {
      received();
      return null;
    });
    const result = callTool('saul_tabs_list');
    const check = expect(result).rejects.toThrow('disconnected');
    await incoming;
    const stopped = once(child, 'exit');
    child.stdin.end();
    await stopped;
    await check;
    expect(await sessions()).toEqual([]);
  });
  it('runs the CLI and MCP handshake/tool discovery/calls over stdio', async () => {
    await host();
    const cli = await subprocess('native/cli.mjs', ['list', '{"windowId":7}']);
    expect(cli.code).toBe(0);
    expect(JSON.parse(cli.stdout).echoed).toEqual({ windowId: 7 });
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'saul_tabs_list', arguments: {} },
      },
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'saul_tabs_group', arguments: { tabIds: [] } },
      },
      { jsonrpc: '2.0', id: 5, method: 'unknown' },
    ];
    const mcp = await subprocess(
      'native/mcp.mjs',
      [],
      requests.map((r) => JSON.stringify(r)).join('\n') + '\n',
    );
    expect(mcp.code).toBe(0);
    expect(mcp.stderr).toBe('');
    const responses = mcp.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(responses.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
    expect(responses[0].result.protocolVersion).toBe('2025-06-18');
    expect(responses[1].result.tools).toHaveLength(7);
    expect(JSON.parse(responses[2].result.content[0].text).method).toBe('saul_tabs_list');
    expect(responses[3].result.isError).toBe(true);
    expect(responses[4].error.code).toBe(-32601);
  });
  it('installs executable wrappers correctly even with spaces and quotes in paths', async () => {
    const installDir = join(directory, "Saul's files");
    const manifestDir = join(directory, 'Native Messaging');
    const result = await subprocess('native/install.mjs', [
      '--extension-id',
      'a'.repeat(32),
      '--install-dir',
      installDir,
      '--manifest-dir',
      manifestDir,
    ]);
    expect(result.code).toBe(0);
    const manifest = JSON.parse(readFileSync(join(manifestDir, 'com.saul.tabs.json'), 'utf8'));
    expect(manifest.allowed_origins).toEqual([`chrome-extension://${'a'.repeat(32)}/`]);
    expect(statSync(manifest.path).mode & 0o777).toBe(0o700);
    const child = spawn(join(installDir, 'bin/saul'), ['sessions'], { env: process.env });
    children.push(child);
    let stdout = '';
    child.stdout.on('data', (data) => {
      stdout += data;
    });
    const [code] = await once(child, 'exit');
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ sessions: [] });
    expect(() => installationPlan({ extensionId: '../bad' })).toThrow('32-letter');
  });
});
