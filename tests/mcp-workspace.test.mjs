import { beforeEach, expect, it, vi } from 'vitest';
import { createWorkspace, projectLayout, revision, closedSnapshot } from '../native/workspace.mjs';
import { APP_TOOLS } from '../native/app-protocol.mjs';
import { createWindowLabels } from '../native/window-labels.mjs';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    if (name === 'saul_windows_label') {
      for (const window of args.windows)
        snapshot.windows.find((w) => w.id === window.windowId).title = window.title;
      return { dryRun: false, windows: args.windows };
    }
    if (name === 'saul_tabs_close_duplicates') {
      for (const duplicate of args.duplicates) snapshot = closedSnapshot(snapshot, duplicate.tabId);
      return { dryRun: false, tabIds: args.duplicates.map((d) => d.tabId) };
    }
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
  call.mock.calls.filter(
    ([name]) => !['saul_sessions', 'saul_tabs_list', 'saul_windows_label'].includes(name),
  );
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
    { windowId: 1, title: 'Window 1', tabIds: [12] },
    { windowId: 2, title: 'Window 2', tabIds: [20, 21] },
  ]);
  expect(result.structuredContent.proposal).toBeNull();
  expect(result._meta.approvalToken).toBeUndefined();
  expect(mutations()).toHaveLength(0);
  await expect(workspace('saul_workspace_apply', approve(original))).rejects.toThrow('Approval');
});

it('shares reviewed labels through the extension across MCP restart and retires helper labels', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'saul-window-labels-'));
  try {
    workspace = createWorkspace({ call, labels: createWindowLabels(directory) });
    const proposal = await propose();
    expect(createWindowLabels(directory).get(session)).toEqual({});
    const applied = await workspace('saul_workspace_apply', approve(proposal));
    expect(applied.structuredContent.snapshot.windows).toEqual([
      { id: 1, title: 'Work' },
      { id: 100, title: 'Reading' },
    ]);
    const restarted = createWorkspace({ call, labels: createWindowLabels(directory) });
    const refreshed = await restarted('saul_workspace_show', { session });
    expect(refreshed.structuredContent.snapshot.windows).toEqual(
      applied.structuredContent.snapshot.windows,
    );
    expect(refreshed.structuredContent.proposal).toBeNull();
    const file = join(directory, 'workspace-labels.json');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      [session]: {},
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(createWindowLabels(directory).get('b'.repeat(16))).toEqual({});
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('label-only changes require review and do not move Chrome tabs', async () => {
  const proposal = await propose([
    { windowId: 1, title: 'Work', tabIds: [12] },
    { windowId: 2, title: 'Reading', tabIds: [20, 21] },
  ]);
  expect(proposal.structuredContent.proposal.changedTabIds).toEqual([]);
  expect(mutations()).toEqual([]);
  const result = await workspace('saul_workspace_apply', approve(proposal));
  expect(result.structuredContent.snapshot.windows.map((w) => w.title)).toEqual([
    'Work',
    'Reading',
  ]);
  expect(mutations()).toEqual([]);
  expect(call).toHaveBeenCalledWith(
    'saul_windows_label',
    expect.objectContaining({
      windows: [
        { windowId: 1, title: 'Work' },
        { windowId: 2, title: 'Reading' },
      ],
      dryRun: false,
    }),
  );
});

it('imports existing helper labels on apply without overriding labels already shared by the extension', async () => {
  const labels = createWindowLabels();
  labels.save(session, { 1: 'Old work', 2: 'Old reading' }, [session]);
  snapshot.windows[0].title = 'Extension work';
  workspace = createWorkspace({ call, labels });
  const shown = await workspace('saul_workspace_show', { session });
  expect(shown.structuredContent.snapshot.windows.map((w) => w.title)).toEqual([
    'Extension work',
    'Old reading',
  ]);
  expect(call.mock.calls.some(([name]) => name === 'saul_windows_label')).toBe(false);
  const plan = await workspace('saul_workspace_propose', {
    session,
    revision: shown.structuredContent.revision,
    summary: '',
    windows: [
      { windowId: 1, title: 'Work', tabIds: [12, 20] },
      { title: 'Reading', tabIds: [21] },
    ],
  });
  expect(
    (await workspace('saul_workspace_apply', approve(plan))).structuredContent.proposal.status,
  ).toBe('applied');
  expect(labels.get(session)).toEqual({});
});

it('deduplicates exact URLs by default in the preview and closes only reviewed copies after moves', async () => {
  snapshot.tabs[4].url = snapshot.tabs[3].url;
  const plan = await propose();
  expect(plan.structuredContent.proposal.duplicates).toEqual([
    { tabId: 21, keepTabId: 20, url: 'https://research.test/' },
  ]);
  expect(plan.structuredContent.proposal.projected).toEqual([
    { id: 1, title: 'Work', tabIds: [10, 11, 12, 20] },
  ]);
  expect(mutations()).toEqual([]);
  const applied = await workspace('saul_workspace_apply', approve(plan));
  expect(applied.structuredContent.proposal.status).toBe('applied');
  expect(applied.structuredContent.proposal.receipt.completedClosures).toBe(1);
  expect(snapshot.tabs.map((t) => t.id)).toEqual([10, 11, 12, 20]);
  expect(snapshot.windows.map((w) => w.id)).toEqual([1]);
  expect(applied.structuredContent.proposal.projected[0].id).toBe(1);
  await expect(workspace('saul_workspace_apply', approve(plan))).rejects.toThrow();
});

it('preserves pins, groups, URL queries and fragments, and supports keeping duplicates', async () => {
  snapshot.tabs[2].url = snapshot.tabs[0].url;
  snapshot.tabs[3].url = snapshot.tabs[1].url;
  let plan = await propose();
  expect(plan.structuredContent.proposal.duplicates.map((d) => d.tabId)).toEqual([12, 20]);
  const keep = await workspace('saul_workspace_propose', {
    session,
    revision: revision(snapshot),
    summary: '',
    deduplicate: false,
    windows: plan.structuredContent.proposal.windows,
  });
  expect(keep.structuredContent.proposal.duplicates).toEqual([]);
  snapshot.tabs[2].url = 'https://read.test/?page=1#first';
  snapshot.tabs[3].url = 'https://read.test/?page=2#first';
  snapshot.tabs[4].url = 'https://read.test/?page=2#second';
  plan = await propose();
  expect(plan.structuredContent.proposal.duplicates).toEqual([]);
});

it('keeps an active duplicate and detects a label edit after preview', async () => {
  snapshot.tabs[4].url = snapshot.tabs[3].url;
  snapshot.tabs[4].active = true;
  const plan = await propose();
  expect(plan.structuredContent.proposal.duplicates[0]).toMatchObject({ tabId: 20, keepTabId: 21 });
  snapshot.windows[0].title = 'Changed elsewhere';
  await expect(workspace('saul_workspace_apply', approve(plan))).rejects.toThrow('stale');
  expect(mutations()).toEqual([]);
});

it('imports helper labels even when the reviewed layout and titles already match', async () => {
  const labels = createWindowLabels();
  labels.save(session, { 1: 'Work', 2: 'Reading' }, [session]);
  workspace = createWorkspace({ call, labels });
  const current = await workspace('saul_workspace_show', { session });
  const plan = await workspace('saul_workspace_propose', {
    session,
    revision: current.structuredContent.revision,
    summary: '',
    windows: [
      { windowId: 1, title: 'Work', tabIds: [12] },
      { windowId: 2, title: 'Reading', tabIds: [20, 21] },
    ],
  });
  expect(plan.structuredContent.proposal).not.toBeNull();
  expect(
    (await workspace('saul_workspace_apply', approve(plan))).structuredContent.proposal.status,
  ).toBe('applied');
  expect(snapshot.windows.map((w) => w.title)).toEqual(['Work', 'Reading']);
  expect(mutations()).toEqual([]);
});

it('consumes approval after an uncertain duplicate closure and never replays it', async () => {
  snapshot.tabs[4].url = snapshot.tabs[3].url;
  const plan = await propose();
  const original = call.getMockImplementation();
  call.mockImplementation(async (name, args) => {
    const result = await original(name, args);
    if (name === 'saul_tabs_close_duplicates') throw new Error('Lost close response');
    return result;
  });
  const result = await workspace('saul_workspace_apply', approve(plan));
  expect(result.structuredContent.proposal.status).toBe('failed');
  expect(snapshot.tabs.some((t) => t.id === 21)).toBe(false);
  await expect(workspace('saul_workspace_apply', approve(plan))).rejects.toThrow();
  expect(call.mock.calls.filter(([name]) => name === 'saul_tabs_close_duplicates')).toHaveLength(1);
});

it('keeps an expired draft editable but consumes its approval until renewed', async () => {
  const old = await propose();
  now += 300001;
  const expired = await workspace('saul_workspace_state', { session });
  expect(expired.structuredContent.proposal.status).toBe('expired');
  expect(expired.structuredContent.proposal.projected).toEqual(
    old.structuredContent.proposal.projected,
  );
  expect(expired._meta.approvalToken).toBeUndefined();
  await expect(workspace('saul_workspace_apply', approve(old))).rejects.toThrow();
  const renewed = await propose(expired.structuredContent.proposal.windows);
  expect(renewed.structuredContent.proposal.status).toBe('pending');
  expect(renewed._meta.approvalToken).not.toBe(old._meta.approvalToken);
  expect(mutations()).toEqual([]);
});

it('can label a window containing only pins/groups while rejecting empty new windows', async () => {
  snapshot.tabs = snapshot.tabs.filter((t) => t.id !== 12);
  const proposal = await propose([
    { windowId: 1, title: 'Pinned references', tabIds: [] },
    { windowId: 2, title: 'Reading', tabIds: [20, 21] },
  ]);
  const applied = await workspace('saul_workspace_apply', approve(proposal));
  expect(applied.structuredContent.snapshot.windows[0].title).toBe('Pinned references');
  expect(mutations()).toEqual([]);
  expect(() =>
    projectLayout(snapshot, [
      { windowId: 2, title: 'Reading', tabIds: [20, 21] },
      { title: 'Empty', tabIds: [] },
    ]),
  ).toThrow('at least one tab');
});
