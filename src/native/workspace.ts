import { handleTabCallUnlocked as handleTabCall, withTabLock } from './tabs';

import { validateCall } from '../../native/protocol.mjs';
import { id, record } from '../contracts/reading';
import type { TabSnapshot, ToolArgs, ToolResults, BrowserTool } from '../../native/protocol.mjs';
export type { TabSnapshot } from '../../native/protocol.mjs';
export type WorkspaceTool = Exclude<BrowserTool, 'saul_tabs_list'>;
export type WorkspacePreviewArgs<K extends WorkspaceTool> = Omit<ToolArgs[K], 'session' | 'dryRun'>;
export type WorkspacePreviewRequest<K extends WorkspaceTool = WorkspaceTool> =
  K extends WorkspaceTool ? { action: 'preview'; method: K; args: WorkspacePreviewArgs<K> } : never;
export interface WorkspaceSnapshotResult {
  snapshot: TabSnapshot;
  canUndo: boolean;
}
export interface WorkspacePreviewResult<K extends WorkspaceTool = WorkspaceTool> {
  snapshot: TabSnapshot;
  token: string;
  plan: ToolResults[K];
}
export interface WorkspaceOperations {
  list: { request: { action: 'list' }; result: WorkspaceSnapshotResult };
  preview: { request: WorkspacePreviewRequest; result: WorkspacePreviewResult };
  apply: { request: { action: 'apply'; token: string }; result: WorkspaceSnapshotResult };
  undo: { request: { action: 'undo' }; result: WorkspaceSnapshotResult };
}
export type WorkspaceAction = keyof WorkspaceOperations;
export type WorkspaceRequest<K extends WorkspaceAction = WorkspaceAction> =
  WorkspaceOperations[K]['request'];
export type WorkspaceResult<K extends WorkspaceAction = WorkspaceAction> =
  WorkspaceOperations[K]['result'];
export type WorkspaceResultFor<T extends WorkspaceRequest> = T extends {
  action: 'preview';
  method: infer K;
}
  ? K extends WorkspaceTool
    ? WorkspacePreviewResult<K>
    : never
  : T extends { action: infer K extends Exclude<WorkspaceAction, 'preview'> }
    ? WorkspaceResult<K>
    : never;
const list = () => handleTabCall('saul_tabs_list');

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
const workspaceTools = new Set<WorkspaceTool>([
  'saul_tabs_sort',
  'saul_tabs_group',
  'saul_tabs_ungroup',
  'saul_tabs_move',
  'saul_groups_update',
]);
export function validateWorkspaceRequest(value: unknown): asserts value is WorkspaceRequest {
  if (!record(value)) throw new Error('Invalid tab workspace request');
  if (value.action === 'list' || value.action === 'undo') return;
  if (value.action === 'apply' && id(value.token)) return;
  if (
    value.action !== 'preview' ||
    typeof value.method !== 'string' ||
    !workspaceTools.has(value.method as WorkspaceTool) ||
    !record(value.args) ||
    'session' in value.args ||
    'dryRun' in value.args
  )
    throw new Error('Invalid tab workspace request');
  validateCall(value.method, value.args);
}
export function workspaceCall(request: unknown): Promise<WorkspaceResult> {
  validateWorkspaceRequest(request);
  return withTabLock(() => execute(request));
}
async function execute(request: WorkspaceRequest): Promise<WorkspaceResult> {
  if (request.action === 'list') {
    const snapshot = await list();
    if (undo && fingerprint(snapshot) !== undo.after) undo = undefined;
    return { snapshot, canUndo: Boolean(undo) };
  }
  if (request.action === 'preview') {
    const before = await list();
    const args = { ...request.args, dryRun: true };
    const plan = await handleTabCall(request.method, args);
    const token = crypto.randomUUID();
    if (previews.size >= 20) previews.delete(previews.keys().next().value!);
    previews.set(token, { method: request.method, args, before, fingerprint: fingerprint(before) });
    return { token, plan, snapshot: before } as WorkspacePreviewResult;
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
