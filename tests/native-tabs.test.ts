import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { handleTabCall, sortBlocks } from '../src/native/tabs';
import { validateCall } from '../native/protocol.mjs';
import type { TabSnapshot } from '../native/protocol.mjs';

const tab = (id: number, index: number, title: string, extra = {}) =>
  ({
    id,
    index,
    title,
    windowId: 1,
    groupId: -1,
    pinned: false,
    incognito: false,
    active: false,
    highlighted: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    url: `https://${title.toLowerCase()}.example/`,
    ...extra,
  }) as chrome.tabs.Tab;
let tabs: chrome.tabs.Tab[];
const testBrowser = () => ({
  windows: {
    get: vi.fn(async (id: number) => ({ id, type: 'normal', incognito: id === 9 })),
    getAll: vi.fn(async () => [
      { id: 1, type: 'normal' },
      { id: 9, type: 'normal', incognito: true },
    ]),
  },
  tabs: {
    query: vi.fn(async () => tabs),
    get: vi.fn(async (id: number) => {
      const found = tabs.find((item) => item.id === id);
      if (!found) throw new Error('No tab with id');
      return found;
    }),
    move: vi.fn(async () => undefined),
    group: vi.fn(async () => 10),
    ungroup: vi.fn(async () => undefined),
  },
  tabGroups: {
    query: vi.fn(async () => [
      { id: 8, windowId: 1 },
      { id: 9, windowId: 9 },
    ]),
    get: vi.fn(async (id: number) => ({ id, windowId: id === 9 ? 9 : 1, title: 'Old' })),
    move: vi.fn(async () => undefined),
    update: vi.fn(async (id: number, values: object) => ({ id, ...values })),
  },
});
let browser: ReturnType<typeof testBrowser>;
beforeEach(() => {
  tabs = [
    tab(1, 0, 'Pinned', { pinned: true }),
    tab(2, 1, 'Zebra'),
    tab(3, 2, 'Beta', { groupId: 8 }),
    tab(4, 3, 'Alpha', { groupId: 8 }),
    tab(5, 4, 'Apple'),
  ];
  browser = testBrowser();
  vi.stubGlobal('chrome', browser as unknown as typeof chrome);
});
afterEach(() => vi.unstubAllGlobals());

describe('tab tools', () => {
  it('lists tab metadata and groups but excludes private windows', async () => {
    tabs.push(tab(9, 0, 'Private', { windowId: 9, incognito: true }));
    const result = (await handleTabCall('saul_tabs_list')) as TabSnapshot;
    expect(result.tabs.map((item) => item.id)).toEqual([1, 2, 3, 4, 5]);
    expect(result.groups).toEqual([{ id: 8, windowId: 1 }]);
    expect(result.tabs[0]).toMatchObject({
      title: 'Pinned',
      url: 'https://pinned.example/',
      pinned: true,
    });
  });
  it('previews sorting by default without moving anything', async () => {
    expect(await handleTabCall('saul_tabs_sort', { windowId: 1, by: 'title' })).toEqual({
      dryRun: true,
      windowId: 1,
      tabIds: [1, 5, 3, 4, 2],
    });
    expect(browser.tabs.move).not.toHaveBeenCalled();
    expect(browser.tabGroups.move).not.toHaveBeenCalled();
  });
  it('sorts with pinned tabs fixed and existing group membership intact', async () => {
    await handleTabCall('saul_tabs_sort', { windowId: 1, by: 'title', dryRun: false });
    expect(browser.tabs.move.mock.calls).toEqual([
      [5, { index: 1 }],
      [2, { index: 4 }],
    ]);
    expect(browser.tabGroups.move.mock.calls).toEqual([[8, { index: 2 }]]);
    expect(browser.tabs.ungroup).not.toHaveBeenCalled();
  });
  it('sorts domains stably and handles internal or pending URLs', () => {
    const sample = [
      tab(1, 0, 'a', { url: 'chrome://settings' }),
      tab(2, 1, 'b', { url: '', pendingUrl: 'https://z.example' }),
      tab(3, 2, 'c', { url: 'https://a.example' }),
    ];
    expect(
      sortBlocks(sample, 'domain', true)
        .flat()
        .map((t) => t.id),
    ).toEqual([2, 1, 3]);
  });
  it('validates all IDs before applying a group and rejects pinned or cross-window tabs', async () => {
    for (const tabIds of [
      [2, 999],
      [1, 2],
    ])
      await expect(handleTabCall('saul_tabs_group', { tabIds, dryRun: false })).rejects.toThrow();
    tabs.push(tab(6, 0, 'Other', { windowId: 2 }));
    await expect(
      handleTabCall('saul_tabs_group', { tabIds: [2, 6], dryRun: false }),
    ).rejects.toThrow('one window');
    expect(browser.tabs.group).not.toHaveBeenCalled();
  });
  it('previews grouping, then creates and names a group', async () => {
    const args = { tabIds: [2, 5], title: 'Research', color: 'blue' };
    await handleTabCall('saul_tabs_group', args);
    expect(browser.tabs.group).not.toHaveBeenCalled();
    await handleTabCall('saul_tabs_group', { ...args, dryRun: false });
    expect(browser.tabs.group).toHaveBeenCalledWith({ tabIds: [2, 5] });
    expect(browser.tabGroups.update).toHaveBeenCalledWith(10, { title: 'Research', color: 'blue' });
  });
  it('can append to a group, update it, and ungroup explicit tabs', async () => {
    await handleTabCall('saul_tabs_group', { tabIds: [2], groupId: 8, dryRun: false });
    expect(browser.tabs.group).toHaveBeenCalledWith({ tabIds: [2], groupId: 8 });
    await handleTabCall('saul_groups_update', { groupId: 8, collapsed: true, dryRun: false });
    expect(browser.tabGroups.update).toHaveBeenCalledWith(8, { collapsed: true });
    await handleTabCall('saul_tabs_ungroup', { tabIds: [3, 4], dryRun: false });
    expect(browser.tabs.ungroup).toHaveBeenCalledWith([3, 4]);
  });
  it('rejects incognito windows and groups', async () => {
    await expect(
      handleTabCall('saul_tabs_sort', { windowId: 9, by: 'domain', dryRun: false }),
    ).rejects.toThrow('non-incognito');
    await expect(
      handleTabCall('saul_groups_update', { groupId: 9, title: 'x', dryRun: false }),
    ).rejects.toThrow('non-incognito');
  });
  it('moves tabs in requested order with final-position indexing', async () => {
    await handleTabCall('saul_tabs_move', { tabIds: [5, 2], windowId: 1, index: 1, dryRun: false });
    expect(browser.tabs.move.mock.calls).toEqual([
      [5, { windowId: 1, index: -1 }],
      [2, { windowId: 1, index: -1 }],
      [5, { windowId: 1, index: 1 }],
      [2, { windowId: 1, index: 2 }],
    ]);
  });
  it('refuses moves that split groups, unpin tabs or target invalid positions', async () => {
    for (const args of [
      { tabIds: [2], index: 2 },
      { tabIds: [1], index: -1 },
      { tabIds: [3], index: -1 },
      { tabIds: [2], index: 0 },
      { tabIds: [2], index: 99 },
    ]) {
      await expect(
        handleTabCall('saul_tabs_move', { ...args, windowId: 1, dryRun: false }),
      ).rejects.toThrow();
    }
    expect(browser.tabs.move).not.toHaveBeenCalled();
  });
  it('rejects unknown operations, extra arguments, invalid values and duplicate IDs', () => {
    for (const [name, args] of [
      ['saul_tabs_close', {}],
      ['saul_tabs_group', { tabIds: [2, 2] }],
      ['saul_tabs_group', { tabIds: [] }],
      ['saul_tabs_group', { tabIds: [2], color: 'invalid' }],
      ['saul_tabs_list', { windowId: -1 }],
      ['saul_tabs_sort', { windowId: 1, by: 'title', dryRun: 'false' }],
      ['saul_tabs_list', { evaluate: 'script' }],
    ] as const) {
      expect(() => validateCall(name, args)).toThrow();
    }
  });
});
