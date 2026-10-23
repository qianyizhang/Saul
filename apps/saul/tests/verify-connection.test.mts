import type { Verification } from '../scripts/verify-connection.mts';
import { expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MCP_TOOLS } from '../native/app-protocol.mts';
import { verifyConnection, verifyMcp } from '../scripts/verify-connection.mts';

it('checks the registered transport with its environment/cwd and returns honest connection status', async () => {
  const transport = {
    type: 'stdio',
    command: '/node with spaces/node',
    args: ['/installed/bridge/mcp.mjs'],
    env: { SAUL_RUNTIME_DIR: '/fixture/runtime' },
    cwd: '/fixture',
  };
  const list = vi.fn(async () => [{ name: 'saul-tabs', enabled: true, transport }]);
  const verify = vi.fn(
    async (): Promise<Verification> => ({ status: 'waiting-for-browser', inventories: [] }),
  );
  const id = 'a'.repeat(32);
  expect(await verifyConnection(id, { list, verify })).toEqual({
    status: 'waiting-for-browser',
    inventories: [],
    exitCode: 2,
  });
  expect(verify).toHaveBeenCalledWith(transport, id);
  verify.mockResolvedValueOnce({ status: 'ready', inventories: [{ tabs: 2, windows: 1 }] });
  expect((await verifyConnection(undefined, { list, verify })).exitCode).toBe(0);
});

it('rejects invalid IDs and missing, disabled or non-local registrations before launching a transport', async () => {
  const verify = vi.fn();
  const list = vi.fn();
  await expect(verifyConnection('invalid', { list, verify })).rejects.toThrow('extension ID');
  expect(list).not.toHaveBeenCalled();
  for (const registrations of [
    [],
    [{ name: 'saul-tabs', enabled: false }],
    [{ name: 'saul-tabs', transport: { type: 'http' } }],
  ]) {
    list.mockResolvedValueOnce(registrations);
    await expect(verifyConnection(undefined, { list, verify })).rejects.toThrow();
  }
  expect(verify).not.toHaveBeenCalled();
});

it('reports a failed MCP check instead of converting it to an offline success', async () => {
  const list = async () => [{ name: 'saul-tabs', transport: { type: 'stdio', command: '/node' } }];
  await expect(
    verifyConnection(undefined, {
      list,
      verify: async () => {
        throw new Error('bad resource');
      },
    }),
  ).rejects.toThrow('bad resource');
});

it('reads the board URI advertised by a separately installed generation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'saul-verify-installed-'));
  const resourceUri = 'ui://installed-generation/board-older-than-checkout.html';
  try {
    const script = join(directory, 'mcp.mjs');
    const trace = join(directory, 'resources.json');
    await writeFile(
      script,
      `
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
const resourceUri = ${JSON.stringify(resourceUri)};
const tools = ${JSON.stringify(MCP_TOOLS.map(({ name }) => ({ name })))};
tools.find((tool) => tool.name === 'saul_workspace_show')._meta = { ui: { resourceUri } };
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result;
  if (request.method === 'initialize') result = { serverInfo: { name: 'installed-fixture', version: '1' } };
  else if (request.method === 'tools/list') result = { tools };
  else if (request.method === 'resources/read') {
    writeFileSync(${JSON.stringify(trace)}, JSON.stringify(request.params));
    if (request.params.uri !== resourceUri) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32602, message: 'This installed generation has a different resource URI' } }) + '\\n');
      return;
    }
    result = { contents: [{ uri: resourceUri, mimeType: 'text/html;profile=mcp-app', text: '<!doctype html><script>const initializeMethod = "ui/initialize";</script>' }] };
  } else if (request.method === 'tools/call' && request.params.name === 'saul_sessions') result = { content: [{ type: 'text', text: JSON.stringify({ sessions: [] }) }] };
  else throw new Error('Unexpected verification request: ' + request.method);
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
});
`,
    );
    const result = await verifyMcp({ command: process.execPath, args: [script], cwd: directory });
    expect(result).toMatchObject({
      status: 'waiting-for-browser',
      server: { name: 'installed-fixture', version: '1' },
      appResource: resourceUri,
      inventories: [],
    });
    expect(JSON.parse(await readFile(trace, 'utf8'))).toEqual({ uri: resourceUri });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
