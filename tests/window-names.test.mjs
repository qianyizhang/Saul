import { it, expect, vi } from 'vitest';
import { createWindowNames, withWindowNames } from '../native/window-names.mjs';

const snapshot = () => ({
  windows: [{ id: 1, title: 'Old' }],
  tabs: [{ id: 10, windowId: 1 }],
  groups: [],
});
const executor = () =>
  vi.fn(async (command, args) => {
    if (command === '/bin/ps')
      return { stdout: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n' };
    const input = JSON.parse(args[3]);
    return {
      stdout: JSON.stringify(
        input.windows.map((w) => ({
          windowId: w.windowId,
          title: input.action === 'apply' ? w.title : 'Native reading',
        })),
      ),
    };
  });

it('targets the connected PID and carries quotes, newlines and script-like titles only as data', async () => {
  const execFile = executor();
  const names = createWindowNames({ browserPid: 123, platform: 'darwin', execFile });
  expect(await names.read(snapshot())).toEqual({
    status: 'available',
    windows: [{ windowId: 1, title: 'Native reading' }],
  });
  const title = '研究 "quoted"\n$(touch /tmp/never)';
  await names.apply(snapshot(), [{ windowId: 1, title, expectedTitle: 'Old' }]);
  const args = execFile.mock.calls.at(-1)[1];
  expect(args.slice(0, 2)).toEqual(['-l', 'JavaScript']);
  expect(JSON.parse(args[3])).toEqual({
    browserPid: 123,
    action: 'apply',
    windows: [{ windowId: 1, title, expectedTitle: 'Old', tabIds: [10] }],
  });
});

it('does not target another application, launch a browser or run scripts on unsupported platforms', async () => {
  const execFile = executor();
  expect(
    (await createWindowNames({ browserPid: 123, platform: 'linux', execFile }).read(snapshot()))
      .status,
  ).toBe('unsupported');
  expect(execFile).not.toHaveBeenCalled();
  expect(await createWindowNames({ platform: 'darwin', execFile }).read(snapshot())).toMatchObject({
    status: 'unavailable',
    message: expect.stringContaining('Reload Saul'),
  });
  execFile.mockResolvedValue({ stdout: '/usr/bin/node' });
  const names = createWindowNames({ browserPid: 123, platform: 'darwin', execFile });
  expect((await names.read(snapshot())).status).toBe('unsupported');
  await names.apply(snapshot(), [{ windowId: 1, title: 'Name' }]);
  expect(execFile).toHaveBeenCalledTimes(1);
});

it('surfaces permission errors without argv/title leakage and rejects mismatched result IDs', async () => {
  const execFile = executor();
  execFile.mockImplementation(async (command) => {
    if (command === '/bin/ps')
      return { stdout: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' };
    throw Object.assign(new Error('Command failed: SECRET TITLE'), {
      stderr: 'Not authorized to send Apple events (-1743)',
    });
  });
  const names = createWindowNames({ browserPid: 123, platform: 'darwin', execFile });
  const result = await names.read(snapshot());
  expect(result).toMatchObject({
    status: 'unavailable',
    message: expect.stringContaining('Automation'),
  });
  expect(result.message).not.toContain('SECRET');
  await expect(names.apply(snapshot(), [{ windowId: 1, title: 'Secret' }])).rejects.toThrow(
    'Automation',
  );
  execFile.mockResolvedValue({ stdout: JSON.stringify([{ windowId: 2, title: 'Wrong' }]) });
  expect((await names.read(snapshot())).status).toBe('unavailable');
});

it('imports native names into initial inventory and extension state without renaming Chrome', async () => {
  const call = vi.fn(async (method) => (method === 'saul_tabs_list' ? snapshot() : {}));
  const names = {
    read: vi.fn(async () => ({
      status: 'available',
      windows: [{ windowId: 1, title: 'Native reading' }],
    })),
    apply: vi.fn(),
  };
  const read = await withWindowNames(call, names)('saul_tabs_list');
  expect(read.windows[0].title).toBe('Native reading');
  expect(call).toHaveBeenCalledWith('saul_windows_label', {
    windows: [{ windowId: 1, title: 'Native reading' }],
    dryRun: false,
  });
  expect(names.apply).not.toHaveBeenCalled();
});

it('verifies native apply before saving extension labels and never saves a failed rename', async () => {
  const call = vi.fn(async () => snapshot());
  const names = {
    read: vi.fn(),
    apply: vi.fn(async () => {
      throw new Error('Stale native name');
    }),
  };
  const invoke = withWindowNames(call, names);
  await expect(
    invoke('saul_windows_label', {
      windows: [{ windowId: 1, title: 'New', expectedTitle: 'Old' }],
      dryRun: false,
    }),
  ).rejects.toThrow('Stale');
  expect(call.mock.calls.map(([method]) => method)).toEqual(['saul_tabs_list']);
});
