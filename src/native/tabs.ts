import { validateCall } from '../../native/protocol.mjs';

type Args = Record<string, any>;
type Tab = chrome.tabs.Tab;
const tabView = (tab: Tab) => ({
  id: tab.id,
  windowId: tab.windowId,
  index: tab.index,
  title: tab.title ?? '',
  url: tab.url || tab.pendingUrl || '',
  active: tab.active,
  pinned: tab.pinned,
  groupId: tab.groupId,
  audible: tab.audible ?? false,
  discarded: tab.discarded,
});

export function sortBlocks(tabs: Tab[], by: 'title' | 'domain', descending = false) {
  const blocks: Tab[][] = [];
  const groups = new Map<number, Tab[]>();
  for (const tab of [...tabs].sort((a, b) => a.index - b.index)) {
    if (tab.pinned) continue;
    if (tab.groupId >= 0) {
      let group = groups.get(tab.groupId);
      if (!group) {
        group = [];
        groups.set(tab.groupId, group);
        blocks.push(group);
      }
      group.push(tab);
    } else blocks.push([tab]);
  }
  const key = (tab: Tab) => {
    if (by === 'title') return (tab.title ?? '').toLocaleLowerCase();
    try {
      return new URL(tab.url || tab.pendingUrl || '').hostname.toLowerCase();
    } catch {
      return '';
    }
  };
  return blocks.sort((a, b) => {
    const x = key(a[0]!),
      y = key(b[0]!);
    return (x < y ? -1 : x > y ? 1 : 0) * (descending ? -1 : 1);
  });
}

let operationQueue = Promise.resolve<unknown>(undefined);
export function withTabLock<T>(operation: () => Promise<T>): Promise<T> {
  const task = operationQueue.then(operation);
  operationQueue = task.catch(() => undefined);
  return task;
}
export function handleTabCall(name: string, args: Args = {}) {
  return withTabLock(() => handleTabCallUnlocked(name, args));
}
// Shared by the native bridge and trusted extension workspace, never webpage callers.
export async function handleTabCallUnlocked(name: string, args: Args = {}) {
  validateCall(name, args);
  const normalWindow = async (windowId: number) => {
    const window = await chrome.windows.get(windowId);
    if (window.incognito || window.type !== 'normal')
      throw new Error('Only non-incognito normal windows are supported');
    return window;
  };
  const getTabs = async () => {
    const tabs = await Promise.all((args.tabIds as number[]).map((id) => chrome.tabs.get(id)));
    for (const windowId of new Set(tabs.map((t) => t.windowId))) await normalWindow(windowId);
    if (tabs.some((t) => t.incognito)) throw new Error('Incognito tabs are excluded');
    return tabs;
  };
  const group = async () => {
    const value = await chrome.tabGroups.get(args.groupId);
    await normalWindow(value.windowId);
    return value;
  };
  const metadata = () =>
    Object.fromEntries(
      ['title', 'color', 'collapsed']
        .filter((key) => args[key] !== undefined)
        .map((key) => [key, args[key]]),
    );
  const dryRun = args.dryRun !== false;

  if (name === 'saul_tabs_list') {
    if (args.windowId !== undefined) await normalWindow(args.windowId);
    const windows = (await chrome.windows.getAll({ windowTypes: ['normal'] })).filter(
      (w) => !w.incognito && (args.windowId === undefined || w.id === args.windowId),
    );
    const windowIds = new Set(windows.map((w) => w.id));
    const tabs = (await chrome.tabs.query({})).filter(
      (t) => !t.incognito && windowIds.has(t.windowId),
    );
    const groups = (await chrome.tabGroups.query({})).filter((g) => windowIds.has(g.windowId));
    return {
      windows: windows.map((w) => ({ id: w.id, focused: w.focused })),
      groups,
      tabs: tabs.sort((a, b) => a.windowId - b.windowId || a.index - b.index).map(tabView),
    };
  }
  if (name === 'saul_tabs_sort') {
    await normalWindow(args.windowId);
    const tabs = await chrome.tabs.query({ windowId: args.windowId });
    const blocks = sortBlocks(tabs, args.by, args.descending);
    const pinned = tabs.filter((t) => t.pinned).sort((a, b) => a.index - b.index);
    const plan = {
      windowId: args.windowId,
      tabIds: [...pinned, ...blocks.flat()].map((t) => t.id),
    };
    if (!dryRun) {
      let index = pinned.length;
      for (const block of blocks) {
        if (block[0]!.groupId >= 0) await chrome.tabGroups.move(block[0]!.groupId, { index });
        else await chrome.tabs.move(block[0]!.id!, { index });
        index += block.length;
      }
    }
    return { dryRun, ...plan };
  }
  if (name === 'saul_groups_update') {
    const before = await group();
    if (Object.keys(metadata()).length === 0) throw new Error('Supply title, color or collapsed');
    return {
      dryRun,
      before,
      group: dryRun
        ? { ...before, ...metadata() }
        : await chrome.tabGroups.update(args.groupId, metadata()),
    };
  }
  if (name === 'saul_tabs_group' || name === 'saul_tabs_ungroup' || name === 'saul_tabs_move') {
    const tabs = await getTabs(); // Validate every ID before any mutation.
    if (name === 'saul_tabs_group') {
      if (tabs.some((t) => t.pinned)) throw new Error('Pinned tabs cannot be grouped');
      if (new Set(tabs.map((t) => t.windowId)).size !== 1)
        throw new Error('Group tabs from one window at a time');
      if (args.groupId !== undefined && (await group()).windowId !== tabs[0]!.windowId)
        throw new Error('Group belongs to another window');
      let groupId = args.groupId;
      if (!dryRun) {
        groupId = await chrome.tabs.group({
          tabIds: args.tabIds,
          ...(groupId === undefined ? {} : { groupId }),
        });
        if (Object.keys(metadata()).length) await chrome.tabGroups.update(groupId, metadata());
      }
      return { dryRun, tabIds: args.tabIds, windowId: tabs[0]!.windowId, groupId, ...metadata() };
    }
    if (name === 'saul_tabs_ungroup') {
      if (!dryRun) await chrome.tabs.ungroup(args.tabIds);
      return { dryRun, tabIds: args.tabIds };
    }
    await normalWindow(args.windowId);
    if (tabs.some((t) => t.pinned || t.groupId >= 0))
      throw new Error('Move requires unpinned, ungrouped tabs; ungroup them first');
    const remaining = (await chrome.tabs.query({ windowId: args.windowId }))
      .filter((t) => !args.tabIds.includes(t.id))
      .sort((a, b) => a.index - b.index);
    const index = args.index === -1 ? remaining.length : args.index;
    if (index > remaining.length || index < remaining.filter((t) => t.pinned).length)
      throw new Error('Index is outside the unpinned insertion range');
    if (
      index > 0 &&
      index < remaining.length &&
      remaining[index]!.groupId >= 0 &&
      remaining[index]!.groupId === remaining[index - 1]!.groupId
    )
      throw new Error('Index would split an existing group');
    if (!dryRun) {
      // Remove selected tabs from the destination first by moving them to its end,
      // then fill the final positions from left to right. This avoids index drift.
      for (const tab of tabs)
        await chrome.tabs.move(tab.id!, { windowId: args.windowId, index: -1 });
      for (let offset = 0; offset < tabs.length; offset++)
        await chrome.tabs.move(tabs[offset]!.id!, {
          windowId: args.windowId,
          index: index + offset,
        });
    }
    return { dryRun, tabIds: args.tabIds, windowId: args.windowId, index };
  }
  throw new Error(`Unsupported browser tool: ${name}`);
}
