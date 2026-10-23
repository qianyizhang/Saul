import { tab } from './fixtures.mts';
import { validateToolResult } from '../native/results.mts';
import type { TabSnapshot } from '../native/protocol.mts';
import { it, expect, vi } from 'vitest';
import { createWindowNames, withWindowNames } from '../native/window-names.mts';

const snapshot = (): TabSnapshot => ({
  windows: [{ id: 1, title: 'Old', focused: false }],
  tabs: [tab({ id: 10, windowId: 1 })],
  groups: [],
});
const executor = () =>
  vi.fn(async (command: string, args: string[]) => {
    if (command === '/bin/ps')
      return { stdout: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n' };
    const input = JSON.parse(args[3]);
    return {
      stdout: JSON.stringify(
        input.windows.map((w: { windowId: number; title: string }) => ({
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
  const args = execFile.mock.calls.at(-1)![1];
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
  expect('message' in result ? result.message : undefined).not.toContain('SECRET');
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
      status: 'available' as const,
      windows: [{ windowId: 1, title: 'Native reading' }],
    })),
    apply: vi.fn(),
  };
  const read = validateToolResult(
    'saul_tabs_list',
    await withWindowNames(call, names)('saul_tabs_list'),
  );
  expect(read.windows[0].title).toBe('Native reading');
  expect(call).toHaveBeenCalledWith('saul_windows_label', {
    windows: [{ windowId: 1, title: 'Native reading' }],
    dryRun: false,
  });
  expect(names.apply).not.toHaveBeenCalled();
});

it('verifies native apply before saving extension labels and never saves a failed rename', async () => {
  const call = vi.fn(async (_method: string) => snapshot());
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

it('reads native names with linear Apple events and validates every target before writing', async () => {
  const { readFileSync } = await import('node:fs');
  const { runInNewContext } = await import('node:vm');
  const source = readFileSync(
    new URL('../.build/native/window-names.jxa', import.meta.url),
    'utf8',
  );
  let idReads = 0,
    writes = 0;
  const native = Array.from({ length: 50 }, (_, i) => {
    let title = `Window ${i}`;
    const window = {
      givenName: () => title,
      id: () => {
        idReads++;
        return i + 1;
      },
      tabs: { id: () => [100 + i] },
    };
    Object.defineProperty(window, 'givenName', {
      get: () => () => title,
      set: (value) => {
        writes++;
        title = value;
      },
    });
    return window;
  });
  const privateWindow = {
    id: () => 999,
    givenName: () => {
      throw new Error('Private name must not be read');
    },
  };
  const windows = () => [...native, privateWindow];
  windows.id = () => [...native.map((_, i) => i + 1), 999];
  windows.mode = () => [...native.map(() => 'normal'), 'incognito'];
  windows.givenName = () => [...native, privateWindow].map((w) => w.givenName());
  const context = {
    run: (_argv: string[]): string => {
      throw new Error('Script did not load');
    },
    Application: () => ({ running: () => true, windows }),
  };
  runInNewContext(source, context);
  const request = {
    browserPid: 123,
    action: 'read',
    windows: native.map((_, i) => ({
      windowId: i + 1,
      tabIds: [100 + i],
      title: '',
      expectedTitle: undefined as string | undefined,
    })),
  };
  const result = JSON.parse(context.run([JSON.stringify(request)]));
  expect(result).toHaveLength(50);
  expect(result[49]).toEqual({ windowId: 50, title: 'Window 49' });
  expect(idReads).toBeLessThanOrEqual(50);
  expect(writes).toBe(0);
  request.action = 'apply';
  request.windows.forEach((w, i) => {
    w.title = `New ${i}`;
    w.expectedTitle = `Window ${i}`;
  });
  request.windows[49].expectedTitle = 'Stale';
  expect(() => context.run([JSON.stringify(request)])).toThrow('changed since preview');
  expect(writes).toBe(0);
  request.windows[49].expectedTitle = 'Window 49';
  request.windows[49].tabIds = [999];
  expect(() => context.run([JSON.stringify(request)])).toThrow('tabs changed');
  expect(writes).toBe(0);
  request.windows[49].tabIds = [149];
  const applied = JSON.parse(context.run([JSON.stringify(request)]));
  expect(applied[49].title).toBe('New 49');
  expect(writes).toBe(50);
});
