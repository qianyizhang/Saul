import { createHash, randomUUID } from 'node:crypto';
import { callTool } from './client.mjs';
import { APP_URI, validateAppCall } from './app-protocol.mjs';
import { createWindowLabels } from './window-labels.mjs';
import { runtimeDirectory } from './transport.mjs';

const fixed = (tab) => tab.pinned || tab.groupId >= 0;
const ordered = (snapshot, windowId) =>
  snapshot.tabs.filter((t) => t.windowId === windowId).sort((a, b) => a.index - b.index);
export function revision(snapshot) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        windows: snapshot.windows.map((w) => w.id).sort((a, b) => a - b),
        tabs: [...snapshot.tabs]
          .sort((a, b) => a.id - b.id)
          .map(({ id, windowId, index, pinned, groupId, url }) => ({
            id,
            windowId,
            index,
            pinned,
            groupId,
            url,
          })),
        groups: [...snapshot.groups]
          .sort((a, b) => a.id - b.id)
          .map(({ id, windowId, title, color, collapsed }) => ({
            id,
            windowId,
            title,
            color,
            collapsed,
          })),
      }),
    )
    .digest('hex');
}
export function projectLayout(before, windows) {
  const movable = before.tabs.filter((t) => !fixed(t));
  const selected = windows.flatMap((w) => w.tabIds);
  if (
    new Set(selected).size !== selected.length ||
    selected.length !== movable.length ||
    movable.some((t) => !selected.includes(t.id))
  )
    throw new Error(
      'Assign every unpinned, ungrouped tab exactly once; pinned/grouped tabs stay fixed',
    );
  const existing = windows.filter((w) => w.windowId !== undefined).map((w) => w.windowId);
  if (new Set(existing).size !== existing.length)
    throw new Error('An existing window may appear only once');
  for (const window of windows) {
    if (window.windowId === undefined) {
      if (!window.tabIds.length) throw new Error('A new window needs at least one tab');
      continue;
    }
    const original = ordered(before, window.windowId);
    if (!original.length) throw new Error('Unknown destination window');
    if (!original.some((t) => fixed(t) || window.tabIds.includes(t.id)))
      throw new Error(
        'Each existing destination must retain an original tab so Chrome cannot close it during the move',
      );
  }
  const projected = windows.map((w, i) => ({
    id: w.windowId ?? `new-${i + 1}`,
    title: w.title,
    tabIds: [
      ...ordered(before, w.windowId)
        .filter(fixed)
        .map((t) => t.id),
      ...w.tabIds,
    ],
  }));
  for (const window of before.windows) {
    if (existing.includes(window.id)) continue;
    const tabIds = ordered(before, window.id)
      .filter(fixed)
      .map((t) => t.id);
    if (tabIds.length)
      projected.push({ id: window.id, title: window.title || `Window ${window.id}`, tabIds });
  }
  return projected;
}
// Pure expected-state transition. Every applied Chrome operation is checked against it.
export function movedSnapshot(before, tabId, destination) {
  const next = structuredClone(before);
  const tab = next.tabs.find((t) => t.id === tabId);
  const source = tab.windowId;
  for (const t of next.tabs) if (t.windowId === source && t.index > tab.index) t.index--;
  tab.windowId = destination;
  tab.index = next.tabs.filter((t) => t.id !== tabId && t.windowId === destination).length;
  if (!next.windows.some((w) => w.id === destination))
    next.windows.push({ id: destination, focused: false });
  next.windows = next.windows.filter((w) => next.tabs.some((t) => t.windowId === w.id));
  return next;
}

export function createWorkspace({
  call = callTool,
  now = Date.now,
  labels = createWindowLabels(call === callTool ? runtimeDirectory() : undefined),
} = {}) {
  const plans = new Map(); // Ephemeral; no browser inventory or approval token written to disk.
  const ttl = 5 * 60 * 1000;
  const expire = () => {
    for (const plan of plans.values())
      if (plan.status === 'pending' && now() > plan.expiresAt) {
        plan.status = 'expired';
        delete plan.approvalToken;
      }
  };
  const state = async (session) => {
    expire();
    const { sessions } = await call('saul_sessions');
    if (!session && sessions.length === 1) session = sessions[0].session;
    if (!session) return { sessions, snapshot: null, proposal: null };
    if (!sessions.some((s) => s.session === session))
      throw new Error('Browser session disconnected; refresh and select a connected session');
    const snapshot = await call('saul_tabs_list', { session });
    const titles = labels.get(session);
    for (const window of snapshot.windows)
      if (titles[window.id] !== undefined) window.title = titles[window.id];
    const currentRevision = revision(snapshot);
    const plan = plans.get(session);
    if (['pending', 'expired'].includes(plan?.status) && plan.revision !== currentRevision)
      plan.status = 'stale';
    const proposal = { ...plan };
    delete proposal.approvalToken;
    return {
      sessions,
      session,
      snapshot,
      revision: currentRevision,
      proposal: plan ? proposal : null,
    };
  };
  const response = (data, render = false) => ({
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
    _meta: {
      ...(render ? { ui: { resourceUri: APP_URI } } : {}),
      ...(data.proposal?.status === 'pending'
        ? { approvalToken: plans.get(data.session)?.approvalToken }
        : {}),
    },
  });
  return async (name, input = {}) => {
    const args = validateAppCall(name, input);
    if (name === 'saul_workspace_show' || name === 'saul_workspace_state')
      return response(await state(args.session), name === 'saul_workspace_show');
    if (name === 'saul_workspace_propose') {
      const current = await state(args.session);
      if (args.revision !== current.revision)
        throw new Error('Layout changed; call saul_workspace_show and propose again');
      const projected = projectLayout(current.snapshot, args.windows);
      const changed = projected
        .flatMap((w) => w.tabIds.map((id, index) => ({ id, windowId: w.id, index })))
        .filter((t) => {
          const old = current.snapshot.tabs.find((x) => x.id === t.id);
          return t.windowId !== old.windowId || t.index !== old.index;
        });
      const renamed = args.windows.some(
        (w) =>
          w.windowId !== undefined &&
          w.title !==
            (current.snapshot.windows.find((x) => x.id === w.windowId)?.title ||
              `Window ${current.snapshot.windows.findIndex((x) => x.id === w.windowId) + 1}`),
      );
      if (!changed.length && !renamed) {
        plans.delete(args.session);
        return response(await state(args.session), true);
      }
      if (plans.size >= 32 && !plans.has(args.session)) plans.delete(plans.keys().next().value);
      plans.set(args.session, {
        id: randomUUID(),
        approvalToken: randomUUID(),
        status: 'pending',
        summary: args.summary,
        windows: args.windows,
        before: current.snapshot,
        projected,
        changedTabIds: changed.map((t) => t.id),
        revision: current.revision,
        expiresAt: now() + ttl,
      });
      return response(await state(args.session), true);
    }
    const current = await state(args.session);
    const plan = plans.get(args.session);
    if (!plan || plan.id !== args.proposalId || plan.approvalToken !== args.approvalToken)
      throw new Error('Approval is missing or expired; open the latest proposal in the app');
    if (plan.status !== 'pending')
      throw new Error(`Proposal is ${plan.status}; make a new proposal`);
    plan.status = 'applying';
    delete plan.approvalToken; // Consume before any side effect, including uncertain failures.
    let expected = current.snapshot;
    let completedMoves = 0;
    const appliedWindows = [];
    const check = async () => {
      const actual = await call('saul_tabs_list', { session: args.session });
      if (revision(actual) !== revision(expected))
        throw new Error('Browser layout changed during apply');
      return actual;
    };
    try {
      for (const window of plan.windows) {
        let destination = window.windowId;
        let remaining = window.tabIds;
        if (destination === undefined) {
          await check();
          const result = await call('saul_windows_create', {
            session: args.session,
            tabIds: [remaining[0]],
            focused: false,
            dryRun: false,
          });
          if (!Number.isSafeInteger(result.windowId))
            throw new Error('Window creation outcome unknown');
          destination = result.windowId;
          expected = movedSnapshot(expected, remaining[0], destination);
          remaining = remaining.slice(1);
          completedMoves++;
          await check();
        }
        const desired = [
          ...ordered(expected, destination)
            .filter(fixed)
            .map((t) => t.id),
          ...window.tabIds,
        ];
        appliedWindows.push({ id: destination, title: window.title });
        if (
          JSON.stringify(ordered(expected, destination).map((t) => t.id)) ===
          JSON.stringify(desired)
        )
          continue;
        for (const tabId of remaining) {
          await check();
          await call('saul_tabs_move', {
            session: args.session,
            tabIds: [tabId],
            windowId: destination,
            index: -1,
            dryRun: false,
          });
          expected = movedSnapshot(expected, tabId, destination);
          completedMoves++;
          await check();
        }
      }
      const actual = await check();
      const titles = labels.get(args.session);
      for (const window of appliedWindows) titles[window.id] = window.title;
      for (const id of Object.keys(titles))
        if (!actual.windows.some((w) => w.id === Number(id))) delete titles[id];
      labels.save(
        args.session,
        titles,
        current.sessions.map((s) => s.session),
      );
      plan.projected = plan.projected.map((w, i) => ({
        ...w,
        id: appliedWindows[i]?.id ?? w.id,
      }));
      plan.status = 'applied';
      plan.receipt = {
        completedMoves,
        message: 'Layout applied and verified. No tabs were closed.',
      };
    } catch (error) {
      plan.status = 'failed';
      plan.receipt = {
        completedMoves,
        message: `${error.message}. Some changes may have completed. Refresh and make a new proposal; this approval cannot be reused.`,
      };
    }
    try {
      return response(await state(args.session));
    } catch (error) {
      return response({
        session: args.session,
        sessions: current.sessions,
        snapshot: null,
        proposal: { ...plan },
        error: `Cannot refresh browser: ${error.message}`,
      });
    }
  };
}
