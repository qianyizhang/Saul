import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setup } from '../scripts/setup.mjs';

let root;
let deps;
let options;
beforeEach(async () => {
  root = await mkdtemp('/tmp/saul-setup-');
  await mkdir(join(root, '.output/chrome-mv3'), { recursive: true });
  await writeFile(join(root, '.output/chrome-mv3/manifest.json'), '{}');
  await writeFile(join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.0.3' }));
  options = {
    extensionId: 'a'.repeat(32),
    installDir: join(root, "Saul's files"),
    manifestDir: join(root, 'Native Hosts'),
  };
  deps = {
    root,
    node: '/node with spaces/node',
    nodeVersion: '24.21.0',
    log: vi.fn(),
    run: vi.fn(async (command, args) => {
      if (command === 'codex' && args[1] === 'list') return '[]';
      if (command === 'pnpm' && args[0] === '--version') return '11.0.3';
      return '';
    }),
    verify: vi.fn(async () => ({
      status: 'ready',
      toolCount: 11,
      inventories: [{ tabs: 2, windows: 1 }],
    })),
  };
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
it('builds, installs and registers with argument arrays, then verifies the registered transport', async () => {
  expect((await setup(options, deps)).exitCode).toBe(0);
  expect(deps.run.mock.calls.map(([command, args]) => [command, args])).toEqual([
    ['codex', ['mcp', 'list', '--json']],
    ['pnpm', ['--version']],
    ['pnpm', ['install', '--frozen-lockfile']],
    ['pnpm', ['build']],
    [
      deps.node,
      [
        join(root, 'native/install.mjs'),
        '--extension-id',
        options.extensionId,
        '--install-dir',
        options.installDir,
        '--manifest-dir',
        options.manifestDir,
      ],
    ],
    [
      'codex',
      ['mcp', 'add', 'saul-tabs', '--', deps.node, join(options.installDir, 'bridge/mcp.mjs')],
    ],
  ]);
  expect(deps.verify).toHaveBeenCalledWith(
    { type: 'stdio', command: deps.node, args: [join(options.installDir, 'bridge/mcp.mjs')] },
    options.extensionId,
  );
});
it('dry-run performs no subprocesses, prompts or verification', async () => {
  deps.ask = vi.fn();
  expect((await setup({ ...options, dryRun: true }, deps)).status).toBe('dry-run');
  expect(deps.run).not.toHaveBeenCalled();
  expect(deps.ask).not.toHaveBeenCalled();
  expect(deps.verify).not.toHaveBeenCalled();
});
it('prepare builds without registering; unattended missing ID returns actionable status', async () => {
  expect((await setup({ prepare: true }, deps)).status).toBe('prepared');
  expect(deps.run.mock.calls.every(([command]) => command === 'pnpm')).toBe(true);
  deps.run.mockClear();
  expect((await setup({ skipBuild: true }, deps)).status).toBe('needs-extension-id');
  expect(deps.run.mock.calls).toHaveLength(1);
  expect(deps.verify).not.toHaveBeenCalled();
});
it('interactive setup requests the actual ID and waits for the Chrome step before verification', async () => {
  deps.ask = vi.fn().mockResolvedValueOnce(options.extensionId).mockResolvedValueOnce('');
  expect((await setup({ ...options, extensionId: undefined, skipBuild: true }, deps)).status).toBe(
    'ready',
  );
  expect(deps.ask).toHaveBeenCalledTimes(2);
  expect(deps.verify.mock.invocationCallOrder[0]).toBeGreaterThan(
    deps.ask.mock.invocationCallOrder[1],
  );
});
it('preserves matching registration command, environment and cwd on reinstall and verify', async () => {
  const transport = {
    type: 'stdio',
    command: '/old/node',
    args: [join(options.installDir, 'bridge/mcp.mjs')],
    env: { SAUL_RUNTIME_DIR: '/tmp/saul-custom' },
    cwd: root,
  };
  deps.run.mockResolvedValue(
    JSON.stringify([{ name: 'saul-tabs', enabled: true, transport, tool_timeout_sec: 45 }]),
  );
  await setup({ ...options, skipBuild: true }, deps);
  expect(deps.run.mock.calls.some(([, args]) => args[1] === 'add')).toBe(false);
  expect(deps.verify).toHaveBeenCalledWith(transport, options.extensionId);
  deps.run.mockClear();
  await setup({ ...options, verify: true }, deps);
  expect(deps.run.mock.calls).toHaveLength(1);
});
it('does not replace unrelated or disabled registrations', async () => {
  for (const registration of [
    { name: 'saul-tabs', transport: { type: 'http', url: 'https://example.com/mcp' } },
    {
      name: 'saul-tabs',
      enabled: false,
      transport: { type: 'stdio', args: [join(options.installDir, 'bridge/mcp.mjs')] },
    },
  ]) {
    deps.run.mockClear().mockResolvedValue(JSON.stringify([registration]));
    await expect(setup(options, deps)).rejects.toThrow();
    expect(deps.run.mock.calls).toHaveLength(1);
  }
  expect(deps.verify).not.toHaveBeenCalled();
});
it('reports offline as waiting and never labels it ready', async () => {
  deps.verify.mockResolvedValue({ status: 'waiting-for-browser', inventories: [] });
  expect(await setup({ ...options, skipBuild: true }, deps)).toMatchObject({
    status: 'waiting-for-browser',
    exitCode: 2,
  });
});
it('stops on prerequisite or installation failure before claiming registration succeeded', async () => {
  await expect(setup(options, { ...deps, nodeVersion: '22.0.0' })).rejects.toThrow('Node 24');
  expect(deps.run).not.toHaveBeenCalled();
  deps.run.mockImplementation(async (command) => {
    if (command === 'codex') return '[]';
    throw new Error('Installer refused conflict');
  });
  await expect(setup({ ...options, skipBuild: true }, deps)).rejects.toThrow('Installer refused');
  expect(deps.run.mock.calls.some(([, args]) => args[1] === 'add')).toBe(false);
  expect(deps.verify).not.toHaveBeenCalled();
});
