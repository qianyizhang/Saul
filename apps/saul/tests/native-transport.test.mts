import { isRecord } from '../shared/model/value.mts';
import { tab } from './fixtures.mts';
import { verifyMcp } from '../scripts/verify-connection.mts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { readdirSync, mkdirSync, mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { endianness } from 'node:os';
import { encodeNative, nativeDecoder, lineDecoder } from '../native/transport.mts';
import { mcpTools, MCP_TOOLS } from '../shared/protocol/app-protocol.mts';
import { startBoardWeb } from '../.build/native/board-http.mjs';
import { BOARD_URI } from '../.build/native/board-resource.mjs';
import { callTool, sessions } from '../native/client.mts';
import { installationPlan } from '../native/installation/installer.mts';

let directory: string;
const children: ReturnType<typeof spawn>[] = [];
beforeEach(() => {
  directory = mkdtempSync('/tmp/saul-test-');
  vi.stubEnv('MCP_APP_LOG_ROOT', join(directory, 'diagnostics'));
  vi.stubEnv('SAUL_RUNTIME_DIR', join(directory, 'run'));
  vi.stubEnv('SAUL_SESSION', undefined);
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
  respond: (
    message: Record<string, unknown>,
  ) => { result?: unknown; error?: { message: string } } | null = (message) => ({
    result: {
      tabs: [],
      groups: [],
      windows: [
        { id: isRecord(message.params) ? (message.params.windowId ?? 0) : 0, focused: false },
      ],
      echoed: message.params,
      method: message.method,
    },
  }),
) {
  const child = spawn(
    process.execPath,
    ['.build/native/host.mjs', `chrome-extension://${'a'.repeat(32)}/`],
    { cwd: resolve('.'), env: process.env },
  );
  children.push(child);
  let stderr = '';
  child.stderr.on('data', (data) => {
    stderr += data;
  });
  await new Promise<void>((resolve, reject) => {
    const decode = nativeDecoder((message) => {
      if (!isRecord(message)) throw new Error('Invalid fixture frame');
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
async function runProcess(
  command: string,
  args: string[] = [],
  input?: string,
  options: { cwd?: string; keepStdinOpen?: boolean } = {},
) {
  const child = spawn(command, args, { env: process.env, cwd: options.cwd });
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
  if (!options.keepStdinOpen) child.stdin.end(input);
  const [code] = await exited;
  return { code, stdout, stderr };
}
async function subprocess(
  script: string,
  args: string[] = [],
  input?: string,
  options: { cwd?: string; keepStdinOpen?: boolean } = {},
) {
  return runProcess(process.execPath, [resolve(script), ...args], input, options);
}

describe('native transport', () => {
  it('setup verification distinguishes an offline server from a complete MCP/browser round trip', async () => {
    const transport = { command: process.execPath, args: [resolve('.build/native/mcp.mjs')] };
    expect(await verifyMcp(transport)).toMatchObject({
      status: 'waiting-for-browser',
      toolCount: MCP_TOOLS.length,
      inventories: [],
    });
    await host(() => ({
      result: {
        tabs: [
          tab({ id: 1, windowId: 2, title: 'PRIVATE TITLE', url: 'https://private.example/' }),
        ],
        windows: [{ id: 2, focused: false }],
        groups: [],
      },
    }));
    const result = await verifyMcp(transport, 'a'.repeat(32));
    expect(result).toMatchObject({
      status: 'ready',
      inventories: [{ tabs: 1, windows: 1, extensionId: 'a'.repeat(32) }],
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(JSON.stringify(result)).not.toContain('private.example');
    expect(await verifyMcp(transport, 'b'.repeat(32))).toMatchObject({
      status: 'waiting-for-browser',
    });
  });
  it('decodes fragmented and concatenated UTF-8 native frames', () => {
    const values: unknown[] = [];
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
    const values: unknown[] = [];
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
    expect(statSync(process.env.SAUL_RUNTIME_DIR!).mode & 0o777).toBe(0o700);
    expect(
      statSync(join(process.env.SAUL_RUNTIME_DIR!, `${active[0].session}.sock`)).mode & 0o777,
    ).toBe(0o600);
    const results = await Promise.all([
      callTool('saul_tabs_list', { windowId: 1 }),
      callTool('saul_tabs_list', { windowId: 2 }),
    ]);
    expect(results.map((r) => r.windows[0].id)).toEqual([1, 2]);
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
  it('returns an empty annotation list through the real CLI and MCP client', async () => {
    const url = 'https://example.com/';
    const args = {
      scope: { urls: [url] },
      author: { kind: 'agent', name: 'Test agent' },
      operation: { action: 'list', url },
    };
    await host((message) => {
      expect(message.method).toBe('saul_annotations');
      return { result: { records: [] } };
    });
    const cli = await subprocess('.build/native/cli.mjs', ['annotations', JSON.stringify(args)]);
    expect(cli.code).toBe(0);
    expect(JSON.parse(cli.stdout)).toEqual({ records: [] });
    const mcp = await subprocess(
      '.build/native/mcp.mjs',
      [],
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'saul_annotations', arguments: args },
      }) + '\n',
    );
    expect(mcp.code).toBe(0);
    expect(JSON.parse(mcp.stdout).result.structuredContent).toEqual({ records: [] });
  });
  it('routes positional CLI and MCP History commands through the same browser tools', async () => {
    const hit = { id: 'ez:fixture', source: 'ez', createdAt: 1, title: 'EZ', excerpt: 'needle' };
    const read = {
      id: hit.id,
      source: hit.source,
      attemptId: hit.id,
      createdAt: 1,
      status: 'completed',
      prompt: 'needle',
      answer: 'answer',
    };
    await host((message) => {
      if (!isRecord(message.params)) throw new Error('Missing History arguments');
      if (message.method === 'saul_history_search' && message.params.query === 'needle')
        return { result: { items: [hit] } };
      if (message.method === 'saul_history_read' && message.params.id === hit.id)
        return { result: read };
      throw new Error('Unexpected History request');
    });
    for (const [action, args, positional, expected] of [
      ['search', { query: 'needle' }, 'needle', { items: [hit] }],
      ['read', { id: hit.id }, hit.id, read],
    ] as const) {
      const cli = await subprocess('.build/native/cli.mjs', ['history', action, positional]);
      expect(cli.code).toBe(0);
      expect(JSON.parse(cli.stdout)).toEqual(expected);
      const structured = await subprocess('.build/native/cli.mjs', [
        'history',
        action,
        '--json',
        JSON.stringify(args),
      ]);
      expect(structured.code).toBe(0);
      expect(JSON.parse(structured.stdout)).toEqual(expected);
      const mcp = await subprocess(
        '.build/native/mcp.mjs',
        [],
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'saul_history_' + action, arguments: args },
        }) + '\n',
      );
      expect(JSON.parse(mcp.stdout).result.structuredContent).toEqual(expected);
    }
    const logs = readdirSync(join(directory, 'diagnostics'), { recursive: true, encoding: 'utf8' })
      .filter((path) => path.endsWith('server.jsonl'))
      .map((path) => readFileSync(join(directory, 'diagnostics', path), 'utf8'))
      .join('\n');
    expect(logs).toContain('saul_history_read');
    expect(logs).not.toContain('needle');
    expect(logs).not.toContain(hit.id);
  });
  it('rejects pending calls and removes its socket when Chrome disconnects', async () => {
    let received!: () => void;
    const incoming = new Promise<void>((resolve) => {
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
  it('routes stdin JSON to the selected session and leaves open stdin alone by default', async () => {
    await host((message) => ({
      result: { items: [], echoed: message.params, profile: 'first' },
    }));
    const [target] = await sessions();
    expect(target).toBeDefined();
    await host((message) => ({
      result: { items: [], echoed: message.params, profile: 'second' },
    }));

    const selected = await subprocess(
      '.build/native/cli.mjs',
      ['--session', target!.session, 'history', 'search', '-'],
      '{"query":"needle","limit":3}',
    );
    expect(selected).toMatchObject({ code: 0, stderr: '' });
    expect(JSON.parse(selected.stdout)).toEqual({
      items: [],
      echoed: { query: 'needle', limit: 3 },
      profile: 'first',
    });

    const ambiguous = await subprocess('.build/native/cli.mjs', ['tabs', 'list'], undefined, {
      keepStdinOpen: true,
    });
    expect(ambiguous).toMatchObject({ code: 1, stdout: '' });
    expect(JSON.parse(ambiguous.stderr)).toEqual({
      error:
        'Multiple browsers/profiles connected. Run saul sessions and pass --session <id> (or set SAUL_SESSION).',
    });

    const mcp = await subprocess(
      '.build/native/mcp.mjs',
      [],
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'saul_tabs_list' },
      }) + '\n',
    );
    expect(JSON.parse(mcp.stdout).result).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'Multiple browsers/profiles connected. Call saul_sessions and supply a session ID.',
        },
      ],
    });
  });
  it('runs the CLI and MCP handshake/tool discovery/calls over stdio', async () => {
    await host();
    const cli = await subprocess('.build/native/cli.mjs', ['tabs', 'list', '{"windowId":7}']);
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
      '.build/native/mcp.mjs',
      [],
      requests.map((r) => JSON.stringify(r)).join('\n') + '\n',
    );
    expect(mcp.code).toBe(0);
    expect(mcp.stderr).toBe('');
    const responses = mcp.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .sort((a, b) => a.id - b.id);
    expect(responses.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
    expect(responses[0].result.protocolVersion).toBe('2025-06-18');
    expect(responses[1].result.tools).toHaveLength(MCP_TOOLS.length);
    expect(
      responses[1].result.tools
        .filter(
          (tool: { _meta?: { ui?: { resourceUri?: string } } }) => tool._meta?.ui?.resourceUri,
        )
        .map((tool: { name: string }) => tool.name),
    ).toEqual(['saul_workspace_show']);
    expect(JSON.parse(responses[2].result.content[0].text).method).toBe('saul_tabs_list');
    expect(responses[3].result.isError).toBe(true);
    expect(responses[4].error.code).toBe(-32601);
  });
  it.each(['MCP', 'HTTP'])(
    '%s keeps discovery responsive and queues browser mutations across failure',
    async (transport) => {
      const arrived = Promise.withResolvers<unknown>();
      const mutations: number[] = [];
      const bridge = await host((message) => {
        const params = message.params as { tabIds: number[] };
        mutations.push(params.tabIds[0]!);
        if (mutations.length === 1) {
          arrived.resolve(message.id);
          return null;
        }
        return { result: { dryRun: false, windowId: 1, tabIds: params.tabIds } };
      });
      const replies = new Map<number, Record<string, unknown>>();
      const mcp =
        transport === 'MCP'
          ? spawn(process.execPath, ['.build/native/mcp.mjs'], { env: process.env })
          : undefined;
      if (mcp) {
        children.push(mcp);
        mcp.stdout.on(
          'data',
          lineDecoder((value) => {
            if (isRecord(value) && typeof value.id === 'number' && isRecord(value.result))
              replies.set(value.id, value.result);
          }),
        );
      }
      const web = transport === 'HTTP' ? await startBoardWeb() : undefined;
      let nextID = 0;
      async function send(name: string, args: unknown = {}) {
        if (web)
          return await (
            await fetch(web.origin + '/api', {
              method: 'POST',
              headers: {
                Origin: web.origin,
                Authorization: 'Bearer ' + new URL(web.url).hash.slice(1),
              },
              body: JSON.stringify({ name, arguments: args }),
            })
          ).json();
        const id = ++nextID;
        mcp!.stdin.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id,
            method: 'tools/call',
            params: { name, arguments: args },
          }) + '\n',
        );
        await vi.waitFor(() => expect(replies.has(id)).toBe(true), { timeout: 3000 });
        return replies.get(id);
      }
      try {
        const first = send('saul_tabs_group', { tabIds: [1], dryRun: false });
        const requestID = await arrived.promise;
        const second = send('saul_tabs_group', { tabIds: [2], dryRun: false });
        const inventory = await send('saul_sessions');
        expect(inventory.structuredContent.sessions).toHaveLength(1);
        expect((await send('diagnostics_info')).structuredContent.instance).toBeTruthy();
        if (mcp) {
          mcp.stdin.write(
            '{"jsonrpc":"2.0","id":101,"method":"ping"}\n{"jsonrpc":"2.0","id":102,"method":"tools/list"}\n',
          );
          await vi.waitFor(() => expect(replies.get(102)?.tools).toHaveLength(MCP_TOOLS.length));
          expect(replies.get(101)).toEqual({});
        }
        expect(mutations).toEqual([1]);
        bridge.stdin.write(
          encodeNative({ id: requestID, error: { message: 'First grouping failed' } }),
        );
        expect((await first).isError).toBe(true);
        expect((await second).structuredContent.tabIds).toEqual([2]);
        expect(mutations).toEqual([1, 2]);
      } finally {
        if (web) await new Promise<void>((resolve) => web.server.close(() => resolve()));
      }
    },
  );
  it('installs a standalone CLI and MCP server that work outside the checkout', async () => {
    const installDir = join(directory, "Saul's files");
    const manifestDir = join(directory, 'Native Messaging');
    const result = await subprocess('.build/native/install.mjs', [
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

    const unrelatedCwd = join(directory, 'unrelated');
    mkdirSync(unrelatedCwd);
    const cli = join(installDir, 'bin/saul');
    const help = await runProcess(cli, ['help'], undefined, { cwd: unrelatedCwd });
    expect(help).toMatchObject({ code: 0, stderr: '' });
    expect(help.stdout).toContain('groups update');

    const version = await runProcess(cli, ['--version'], undefined, { cwd: unrelatedCwd });
    expect(version).toMatchObject({ code: 0, stderr: '' });
    expect(version.stdout).toMatch(/^saul \d+\.\d+\.\d+\n$/);

    const tools = await runProcess(cli, ['tools'], undefined, { cwd: unrelatedCwd });
    expect(tools).toMatchObject({ code: 0, stderr: '' });
    expect(JSON.parse(tools.stdout).map((tool: { name: string }) => tool.name)).toEqual([
      'saul_history_search',
      'saul_history_read',
      'saul_annotations',
      'saul_windows_label',
      'saul_tabs_close_duplicates',
      'saul_windows_create',
      'saul_page_read',
      'saul_page_act',
      'saul_page_navigate',
      'saul_sessions',
      'saul_tabs_list',
      'saul_tabs_sort',
      'saul_tabs_group',
      'saul_tabs_ungroup',
      'saul_tabs_move',
      'saul_groups_update',
    ]);

    const mcp = await subprocess(
      join(installDir, 'bridge/mcp.mjs'),
      [],
      [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      ]
        .map((message) => JSON.stringify(message))
        .join('\n') + '\n',
      { cwd: unrelatedCwd },
    );
    expect(mcp).toMatchObject({ code: 0, stderr: '' });
    const web = spawn(process.execPath, [join(installDir, 'bridge/board-web.mjs')], {
      cwd: unrelatedCwd,
      env: process.env,
    });
    children.push(web);
    const url = await new Promise<string>((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(
        () => reject(new Error('Installed standalone board did not start')),
        5000,
      );
      web.once('exit', () => {
        clearTimeout(timeout);
        reject(new Error('Installed standalone board exited before listening'));
      });
      web.stdout.on('data', (chunk) => {
        output += String(chunk);
        const match = /Saul Tab board: (http:\/\/127\.0\.0\.1:\d+\/#[a-f0-9]+)/.exec(output);
        if (match) {
          clearTimeout(timeout);
          resolve(match[1]);
        }
      });
    });
    const local = new URL(url);
    const diagnostic = await fetch(local.origin + '/api', {
      method: 'POST',
      headers: { Origin: local.origin, Authorization: `Bearer ${local.hash.slice(1)}` },
      body: JSON.stringify({ name: 'diagnostics_info' }),
    });
    expect((await diagnostic.json()).structuredContent).toMatchObject({
      version: '1.4.0',
      health: 'recording',
    });

    const responses = mcp.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .sort((a, b) => a.id - b.id);
    expect(responses[1].result.tools).toEqual(mcpTools(BOARD_URI));
    const resource = await runProcess(
      process.execPath,
      [join(installDir, 'bridge/mcp.mjs')],
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/read',
        params: { uri: BOARD_URI },
      }) + '\n',
      { cwd: unrelatedCwd },
    );
    const html = JSON.parse(resource.stdout).result.contents[0];
    expect(html.mimeType).toBe('text/html;profile=mcp-app');
    expect(html.uri).toBe(
      `ui://saul/workspace-${createHash('sha256').update(html.text).digest('hex').slice(0, 16)}.html`,
    );
    expect(html.text).toContain('ui/initialize');
    expect(html.text).not.toContain('/* SAUL_SCRIPT */');

    const sessionsResult = await runProcess(cli, ['sessions'], undefined, { cwd: unrelatedCwd });
    expect(JSON.parse(sessionsResult.stdout)).toEqual({ sessions: [] });
    expect(() => installationPlan({ extensionId: '../bad' })).toThrow('32-letter');
  });
});
