import { handleTabCallUnlocked as handleTabCall, withTabLock } from './tabs';

export type TabSnapshot = {
  windows: { id: number; focused: boolean }[];
  tabs: {
    id: number;
    windowId: number;
    index: number;
    title: string;
    url: string;
    pinned: boolean;
    groupId: number;
  }[];
  groups: chrome.tabGroups.TabGroup[];
};
export type WorkspaceRequest =
  | { action: 'list' | 'undo' }
  | { action: 'preview'; method: string; args: Record<string, unknown> }
  | { action: 'apply'; token: string };
const list = () => handleTabCall('saul_tabs_list') as Promise<TabSnapshot>;

// The comparison deliberately ignores focus, audio and discarded state: those do
// not change the organization being previewed. URLs and group metadata do.
function fingerprint(snapshot: TabSnapshot) {
  return JSON.stringify({
    tabs: snapshot.tabs.map(({ id, windowId, index, pinned, groupId, title, url }) => ({
      id,
      windowId,
      index,
      pinned,
      groupId,
      title,
      url,
    })),
    groups: snapshot.groups
      .map(({ id, windowId, title, color, collapsed }) => ({
        id,
        windowId,
        title,
        color,
        collapsed,
      }))
      .sort((a, b) => a.id - b.id),
  });
}
const previews = new Map<
  string,
  { method: string; args: Record<string, unknown>; before: TabSnapshot; fingerprint: string }
>();
let undo: { before: TabSnapshot; after: string; windowId: number } | undefined;
export function workspaceCall(request: WorkspaceRequest) {
  return withTabLock(() => execute(request));
}
async function execute(request: WorkspaceRequest) {
  if (request.action === 'list') return { snapshot: await list(), canUndo: Boolean(undo) };
  if (request.action === 'preview') {
    const before = await list();
    const args = { ...request.args, dryRun: true };
    const plan = await handleTabCall(request.method, args);
    const token = crypto.randomUUID();
    if (previews.size >= 20) previews.delete(previews.keys().next().value!);
    previews.set(token, { method: request.method, args, before, fingerprint: fingerprint(before) });
    return { token, plan, snapshot: before };
  }
  if (request.action === 'apply') {
    const preview = previews.get(request.token);
    previews.delete(request.token);
    if (!preview) throw new Error('This preview expired. Preview the operation again.');
    if (fingerprint(await list()) !== preview.fingerprint)
      throw new Error('Tabs changed since this preview. Refresh and preview again.');
    undo = undefined;
    await handleTabCall(preview.method, { ...preview.args, dryRun: false });
    const after = await list();
    if (preview.method === 'saul_tabs_sort')
      undo = {
        before: preview.before,
        after: fingerprint(after),
        windowId: Number(preview.args.windowId),
      };
    return { snapshot: after, canUndo: Boolean(undo) };
  }
  if (request.action === 'undo') {
    const saved = undo;
    if (!saved) throw new Error('No sort is available to undo.');
    if (fingerprint(await list()) !== saved.after) {
      undo = undefined;
      throw new Error('Tabs changed after sorting. Undo was cancelled to preserve your changes.');
    }
    undo = undefined;
    const tabs = saved.before.tabs
      .filter((t) => t.windowId === saved.windowId)
      .sort((a, b) => a.index - b.index);
    const movedGroups = new Set<number>();
    for (const tab of tabs) {
      if (tab.pinned) continue;
      if (tab.groupId >= 0) {
        if (!movedGroups.has(tab.groupId)) {
          await chrome.tabGroups.move(tab.groupId, { index: tab.index });
          movedGroups.add(tab.groupId);
        }
      } else await chrome.tabs.move(tab.id, { index: tab.index });
    }
    return { snapshot: await list(), canUndo: false };
  }
  throw new Error('Unknown workspace operation');
}
