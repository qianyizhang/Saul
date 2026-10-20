import { expect, it, vi } from 'vitest';
import { verifyConnection } from '../scripts/verify-connection.mjs';

it('checks the registered transport with its environment/cwd and returns honest connection status', async () => {
  const transport = {
    type: 'stdio',
    command: '/node with spaces/node',
    args: ['/installed/bridge/mcp.mjs'],
    env: { SAUL_RUNTIME_DIR: '/fixture/runtime' },
    cwd: '/fixture',
  };
  const list = vi.fn(async () => [{ name: 'saul-tabs', enabled: true, transport }]);
  const verify = vi.fn(async () => ({ status: 'waiting-for-browser', inventories: [] }));
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
