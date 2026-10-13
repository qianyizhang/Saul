import { beforeEach, expect, it, vi } from 'vitest';
import { createWorkspace, projectLayout, revision } from '../native/workspace.mjs';
import { APP_TOOLS } from '../native/app-protocol.mjs';

const session = 'a'.repeat(16);
let snapshot, call, workspace, now;
beforeEach(() => {
  now = 1000;
  snapshot = {
    windows: [{ id: 1 }, { id: 2 }],
    groups: [{ id: 8, windowId: 1, title: 'Keep', color: 'blue', collapsed: false }],
    tabs: [
      { id: 10, windowId: 1, index: 0, pinned: true, groupId: -1, url: 'https://pinned.test/' },
      { id: 11, windowId: 1, index: 1, pinned: false, groupId: 8, url: 'https://group.test/' },
      { id: 12, windowId: 1, index: 2, pinned: false, groupId: -1, url: 'https://work.test/' },
      { id: 20, windowId: 2, index: 0, pinned: false, groupId: -1, url: 'https://research.test/' },
      { id: 21, windowId: 2, index: 1, pinned: false, groupId: -1, url: 'https://read.test/' },
    ],
  };
  call = vi.fn(async (name, args) => {
    if (name === 'saul_sessions') return { sessions: [{ session, extensionId: 'b'.repeat(32) }] };
    if (name === 'saul_tabs_list') return structuredClone(snapshot);
    expect(args.dryRun).toBe(false);
    const windowId = name === 'saul_windows_create' ? 100 : args.windowId;
    if (name === 'saul_windows_create') snapshot.windows.push({ id: windowId });
    const tab = snapshot.tabs.find((t) => t.id === args.tabIds[0]);
    const from = snapshot.tabs
      .filter((t) => t.windowId === tab.windowId && t !== tab)
      .sort((a, b) => a.index - b.index);
    from.forEach((t, index) => {
      t.index = index;
    });
    const others = snapshot.tabs.filter((t) => t.windowId === windowId && t !== tab);
    tab.windowId = windowId;
    tab.index = others.length;
    snapshot.windows = snapshot.windows.filter((w) =>
      snapshot.tabs.some((t) => t.windowId === w.id),
    );
    return { windowId };
  });
  workspace = createWorkspace({ call, now: () => now });
});
async function propose(
  windows = [
    { windowId: 1, title: 'Work', tabIds: [12, 20] },
    { title: 'Reading', tabIds: [21] },
  ],
) {
  return workspace('saul_workspace_propose', {
    session,
    revision: revision(snapshot),
    summary: 'Separate work and reading',
    windows,
  });
}
const mutations = () =>
  call.mock.calls.filter(([name]) => !['saul_sessions', 'saul_tabs_list'].includes(name));
const approve = (result) => ({
  session,
  proposalId: result.structuredContent.proposal.id,
  approvalToken: result._meta.approvalToken,
});

it('stages a real projection without mutations; approval is UI-only and not in model content', async () => {
  const result = await propose();
  expect(mutations()).toEqual([]);
  expect(result.structuredContent.proposal.projected).toEqual([
    { id: 1, title: 'Work', tabIds: [10, 11, 12, 20] },
    { id: 'new-2', title: 'Reading', tabIds: [21] },
  ]);
  expect(JSON.stringify(result.structuredContent)).not.toContain(result._meta.approvalToken);
  expect(JSON.stringify(result.content)).not.toContain(result._meta.approvalToken);
  expect(APP_TOOLS.find((t) => t.name === 'saul_workspace_apply')._meta.ui.visibility).toEqual([
    'app',
  ]);
});
it('requires all movable tabs once and preserves anchors for existing destination windows', () => {
  for (const windows of [
    [{ title: 'Missing', tabIds: [12] }],
    [{ title: 'Duplicate', tabIds: [12, 20, 21, 21] }],
    [{ title: 'Pinned', tabIds: [10, 12, 20, 21] }],
    [{ windowId: 999, title: 'Unknown', tabIds: [12, 20, 21] }],
    [
      { windowId: 2, title: 'No anchor', tabIds: [12] },
      { title: 'New', tabIds: [20, 21] },
    ],
  ])
    expect(() => projectLayout(snapshot, windows)).toThrow();
});
it('applies only the reviewed layout, verifies it and rejects replay', async () => {
  const proposal = await propose();
  await expect(
    workspace('saul_workspace_apply', { ...approve(proposal), approvalToken: 'wrong' }),
  ).rejects.toThrow('Approval');
  expect(mutations()).toHaveLength(0);
  const result = await workspace('saul_workspace_apply', approve(proposal));
  expect(result.structuredContent.proposal.status).toBe('applied');
  expect(
    snapshot.tabs
      .filter((t) => t.windowId === 1)
      .sort((a, b) => a.index - b.index)
      .map((t) => t.id),
  ).toEqual([10, 11, 12, 20]);
  expect(snapshot.tabs.find((t) => t.id === 21).windowId).toBe(100);
  expect(snapshot.tabs.map((t) => t.id).sort()).toEqual([10, 11, 12, 20, 21]);
  await expect(workspace('saul_workspace_apply', approve(proposal))).rejects.toThrow();
});
it('stale, replaced and expired proposals cannot apply', async () => {
  const old = await propose();
  const fresh = await propose();
  await expect(workspace('saul_workspace_apply', approve(old))).rejects.toThrow();
  snapshot.tabs[2].url = 'https://changed.test/';
  await expect(workspace('saul_workspace_apply', approve(fresh))).rejects.toThrow('stale');
  const next = await propose();
  now += 300001;
  await expect(workspace('saul_workspace_apply', approve(next))).rejects.toThrow('expired');
  expect(mutations()).toHaveLength(0);
});
it('rejects stale model input and treats active/focus changes as unrelated', async () => {
  const initial = revision(snapshot);
  snapshot.windows[0].focused = true;
  snapshot.tabs[0].active = true;
  expect(revision(snapshot)).toBe(initial);
  snapshot.tabs[2].pinned = true;
  await expect(
    workspace('saul_workspace_propose', {
      session,
      revision: initial,
      summary: '',
      windows: [{ title: 'New', tabIds: [20, 21] }],
    }),
  ).rejects.toThrow('Layout changed');
});
it('an uncertain partial failure consumes approval and returns current state without retry', async () => {
  const proposal = await propose();
  const original = call.getMockImplementation();
  let moved = false;
  call.mockImplementation(async (name, args) => {
    const result = await original(name, args);
    if (name === 'saul_tabs_move' && !moved) {
      moved = true;
      throw new Error('Lost response');
    }
    return result;
  });
  const result = await workspace('saul_workspace_apply', approve(proposal));
  expect(result.structuredContent.proposal.status).toBe('failed');
  expect(result.structuredContent.proposal.receipt.message).toContain(
    'Some changes may have completed',
  );
  expect(mutations()).toHaveLength(1);
  await expect(workspace('saul_workspace_apply', approve(proposal))).rejects.toThrow();
});
it('stops on browser changes between operations instead of adopting the changed state', async () => {
  const proposal = await propose();
  const original = call.getMockImplementation();
  call.mockImplementation(async (name, args) => {
    const result = await original(name, args);
    if (name === 'saul_tabs_move') snapshot.tabs[0].url = 'https://raced.test/';
    return result;
  });
  const result = await workspace('saul_workspace_apply', approve(proposal));
  expect(result.structuredContent.proposal.status).toBe('failed');
  expect(result.structuredContent.proposal.receipt.message).toContain('changed during apply');
  expect(mutations()).toHaveLength(1);
});
it('does not select an arbitrary browser when multiple sessions exist', async () => {
  call.mockResolvedValue({ sessions: [{ session }, { session: 'b'.repeat(16) }] });
  expect((await workspace('saul_workspace_show')).structuredContent.snapshot).toBeNull();
  expect(call).toHaveBeenCalledTimes(1);
});

it('returning to the current layout clears the previous approval without mutations', async () => {
  const original = await propose();
  const result = await propose([
    { windowId: 1, title: 'Work', tabIds: [12] },
    { windowId: 2, title: 'Reading', tabIds: [20, 21] },
  ]);
  expect(result.structuredContent.proposal).toBeNull();
  expect(result._meta.approvalToken).toBeUndefined();
  expect(mutations()).toHaveLength(0);
  await expect(workspace('saul_workspace_apply', approve(original))).rejects.toThrow('Approval');
});
