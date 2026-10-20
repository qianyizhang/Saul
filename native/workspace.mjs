import { createHash, randomUUID } from 'node:crypto';
import { callTool } from './client.mjs';
import { APP_URI, validateAppCall } from './app-protocol.mjs';
import { tabLayoutRevision } from './tab-layout.mjs';
import { createWindowLabels } from './window-labels.mjs';
import { runtimeDirectory } from './transport.mjs';

const fixed = (tab) => tab.pinned || tab.groupId >= 0;
const ordered = (snapshot, windowId) =>
  snapshot.tabs.filter((t) => t.windowId === windowId).sort((a, b) => a.index - b.index);
export function revision(snapshot) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        windows: snapshot.windows
          .map(({ id, title }) => ({ id, title }))
          .sort((a, b) => a.id - b.id),
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
// Keep the longest ordered run of surviving tabs in place. Departures and
// duplicate closures shift indices naturally and must not count as moves.
export function tabMoves(before, projected) {
  const tabs = new Map(before.tabs.map((tab) => [tab.id, tab]));
  const moves = [];
  for (const window of projected) {
    const original = ordered(before, window.id);
    const lastFixed = original.filter(fixed).at(-1)?.index ?? -1;
    const candidates = window.tabIds.filter((id) => {
      const tab = tabs.get(id);
      return !fixed(tab) && tab.windowId === window.id && tab.index > lastFixed;
    });
    const tails = [],
      previous = [];
    for (let i = 0; i < candidates.length; i++) {
      const position = tabs.get(candidates[i]).index;
      let low = 0,
        high = tails.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (tabs.get(candidates[tails[mid]]).index < position) low = mid + 1;
        else high = mid;
      }
      previous[i] = low ? tails[low - 1] : -1;
      tails[low] = i;
    }
    const kept = new Set(window.tabIds.filter((id) => fixed(tabs.get(id))));
    for (let i = tails.at(-1); i !== undefined && i >= 0; i = previous[i]) kept.add(candidates[i]);
    let beforeId;
    // Insert before a settled anchor, from right to left. Outgoing tabs can
    // remain temporarily; removing them later preserves this relative order.
    for (const tabId of [...window.tabIds].reverse()) {
      if (!kept.has(tabId)) moves.push({ tabId, destination: window.id, beforeId });
      beforeId = tabId;
    }
  }
  return moves;
}

// Pure expected-state transition. Every applied Chrome operation is checked against it.
export function movedSnapshot(before, tabId, destination, index = -1) {
  const next = structuredClone(before);
  const tab = next.tabs.find((t) => t.id === tabId);
  const source = tab.windowId;
  for (const t of next.tabs) if (t.windowId === source && t.index > tab.index) t.index--;
  const others = ordered(next, destination).filter((t) => t.id !== tabId);
  tab.windowId = destination;
  tab.index = index < 0 ? others.length : index;
  for (const other of others) if (other.index >= tab.index) other.index++;
  if (!next.windows.some((w) => w.id === destination))
    next.windows.push({
      id: destination,
      focused: false,
      ...(before.nativeNames?.status === 'available' ? { title: '' } : {}),
    });
  next.windows = next.windows.filter((w) => next.tabs.some((t) => t.windowId === w.id));
  return next;
}

export function duplicateTabs(before, projected) {
  const tabs = projected.flatMap((w) => w.tabIds.map((id) => before.tabs.find((t) => t.id === id)));
  const keepers = new Map();
  // Pins and groups are immutable; otherwise keep an active copy before the
  // first copy in the proposed order. Exact URLs preserve queries and fragments.
  for (const tab of [...tabs].sort(
    (a, b) =>
      Number(fixed(b)) - Number(fixed(a)) || Number(Boolean(b.active)) - Number(Boolean(a.active)),
  )) {
    if (/^https?:\/\//.test(tab.url) && !keepers.has(tab.url)) keepers.set(tab.url, tab.id);
  }
  return tabs
    .filter((tab) => !fixed(tab) && keepers.has(tab.url) && keepers.get(tab.url) !== tab.id)
    .map((tab) => ({ tabId: tab.id, keepTabId: keepers.get(tab.url), url: tab.url }));
}

export function closedSnapshot(before, tabId) {
  const next = structuredClone(before);
  const tab = next.tabs.find((t) => t.id === tabId);
  next.tabs = next.tabs.filter((t) => t.id !== tabId);
  for (const other of next.tabs)
    if (other.windowId === tab.windowId && other.index > tab.index) other.index--;
  next.windows = next.windows.filter((w) => next.tabs.some((t) => t.windowId === w.id));
  return next;
}

export function createWorkspace({
  call = callTool,
  now = Date.now,
  labels = createWindowLabels(call === callTool ? runtimeDirectory() : undefined),
} = {}) {
  const interactions = new Map();
  const undos = new Map();
  const plans = new Map(); // Ephemeral; no browser inventory or approval token written to disk.
  const ttl = 5 * 60 * 1000;
  const expire = () => {
    for (const plan of plans.values())
      if (plan.status === 'pending' && now() > plan.expiresAt) {
        plan.status = 'expired';
        delete plan.approvalToken;
      }
  };
  const withLabels = (snapshot, session) => {
    const titles = labels.get(session);
    for (const window of snapshot.windows)
      if (window.title === undefined && titles[window.id] !== undefined)
        window.title = titles[window.id];
    return snapshot;
  };
  const withProposal = (current) => {
    expire();
    const plan = plans.get(current.session);
    if (['pending', 'expired'].includes(plan?.status) && plan.revision !== current.revision)
      plan.status = 'stale';
    const proposal = { ...plan };
    delete proposal.approvalToken;
    return { ...current, proposal: plan ? proposal : null };
  };
  const state = async (session) => {
    const { sessions } = await call('saul_sessions');
    if (!session && sessions.length === 1) session = sessions[0].session;
    if (!session) return { sessions, snapshot: null, proposal: null };
    if (!sessions.some((s) => s.session === session))
      throw new Error('Browser session disconnected; refresh and select a connected session');
    const snapshot = withLabels(await call('saul_tabs_list', { session }), session);
    let summary = null;
    try {
      summary = await call('saul_summary_status', { session });
    } catch {
      /* Reader errors remain visible in Chrome. */
    }
    return withProposal({
      sessions,
      session,
      snapshot,
      revision: revision(snapshot),
      // The extension validates affected windows when Undo is invoked, just
      // as it does for the Window view. Unrelated windows do not hide Undo.
      canUndo: undos.has(session),
      summary,
    });
  };
  function interactionToken(session) {
    if (!interactions.has(session) || interactions.get(session).expiresAt < now()) {
      if (interactions.size >= 32) interactions.delete(interactions.keys().next().value);
      interactions.set(session, { token: randomUUID(), expiresAt: now() + ttl });
    }
    return interactions.get(session).token;
  }
  const response = (data, render = false) => ({
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
    _meta: {
      ...(render ? { ui: { resourceUri: APP_URI } } : {}),
      ...(data.session ? { interactionToken: interactionToken(data.session) } : {}),
      ...(data.proposal?.status === 'pending'
        ? { approvalToken: plans.get(data.session)?.approvalToken }
        : {}),
    },
  });
  return async (name, input = {}) => {
    const args = validateAppCall(name, input);
    if (name === 'saul_workspace_show' || name === 'saul_workspace_state')
      return response(await state(args.session), name === 'saul_workspace_show');
    if (
      [
        'saul_workspace_edit',
        'saul_workspace_undo',
        'saul_workspace_summarize',
        'saul_workspace_discard',
      ].includes(name)
    ) {
      const permission = interactions.get(args.session);
      if (!permission || permission.expiresAt < now() || permission.token !== args.interactionToken)
        throw new Error('Manual action expired. Refresh the Tab board.');
      interactions.delete(args.session);
      if (name === 'saul_workspace_discard') {
        plans.delete(args.session);
        return response(await state(args.session));
      }
      if (name === 'saul_workspace_summarize') {
        await call('saul_summary_open', {
          session: args.session,
          ...(args.tabIds ? { tabIds: args.tabIds } : {}),
          ...(args.id ? { id: args.id } : {}),
        });
        return response(await state(args.session));
      }
      let result;
      if (name === 'saul_workspace_undo') {
        const undo = undos.get(args.session);
        undos.delete(args.session);
        if (!undo) throw new Error('No reversible edit is available.');
        result = await call('saul_tabs_undo', { session: args.session, token: undo });
      } else {
        const current = await state(args.session);
        if (args.revision !== current.revision)
          throw new Error('Tabs changed. Review the refreshed board.');
        const edit = { ...args };
        delete edit.interactionToken;
        delete edit.revision;
        undos.delete(args.session);
        result = await call('saul_tabs_edit', {
          ...edit,
          expected: tabLayoutRevision(current.snapshot),
        });
      }
      if (result.undoToken) undos.set(args.session, result.undoToken);
      plans.delete(args.session);
      return response({ ...(await state(args.session)), notice: result.message });
    }
    if (name === 'saul_workspace_propose') {
      const current = await state(args.session);
      if (args.revision !== current.revision)
        throw new Error('Layout changed; call saul_workspace_show and propose again');
      const layout = projectLayout(current.snapshot, args.windows);
      const duplicates = args.deduplicate === false ? [] : duplicateTabs(current.snapshot, layout);
      const closing = new Set(duplicates.map((d) => d.tabId));
      const projected = layout
        .map((w) => ({ ...w, tabIds: w.tabIds.filter((id) => !closing.has(id)) }))
        .filter((w) => w.tabIds.length);
      const moves = tabMoves(current.snapshot, projected);
      const renamed = args.windows.some(
        (w) =>
          w.windowId !== undefined &&
          w.title !==
            (current.snapshot.windows.find((x) => x.id === w.windowId)?.title ||
              `Window ${current.snapshot.windows.findIndex((x) => x.id === w.windowId) + 1}`),
      );
      const importingLabels = Object.keys(labels.get(args.session)).length > 0;
      if (!moves.length && !renamed && !duplicates.length && !importingLabels) {
        plans.delete(args.session);
        return response(withProposal(current), true);
      }
      if (plans.size >= 32 && !plans.has(args.session)) plans.delete(plans.keys().next().value);
      plans.set(args.session, {
        id: randomUUID(),
        approvalToken: randomUUID(),
        status: 'pending',
        summary: args.summary,
        windows: args.windows,
        deduplicate: args.deduplicate !== false,
        duplicates,
        before: current.snapshot,
        projected,
        changedTabIds: [
          ...new Set([...moves.map((t) => t.tabId), ...duplicates.map((d) => d.tabId)]),
        ],
        revision: current.revision,
        expiresAt: now() + ttl,
      });
      return response(withProposal(current), true);
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
    let completedClosures = 0;
    const appliedWindows = [];
    const destinations = new Map();
    const check = async () => {
      const actual = withLabels(
        await call('saul_tabs_list', { session: args.session }),
        args.session,
      );
      if (
        expected.nativeNames?.status === 'available' &&
        actual.nativeNames?.status !== 'available'
      )
        throw new Error(
          actual.nativeNames?.message || 'Native window names could not be refreshed',
        );
      if (revision(actual) !== revision(expected))
        throw new Error('Browser layout changed during apply');
      return actual;
    };
    try {
      if (current.snapshot.nativeNames?.status === 'unavailable')
        throw new Error(
          current.snapshot.nativeNames.message ||
            'Native Chrome names unavailable; refresh after granting Automation access',
        );
      const moves = tabMoves(plan.before, plan.projected);
      for (const window of plan.projected) {
        let destination = typeof window.id === 'number' ? window.id : undefined;
        for (const move of moves.filter((item) => item.destination === window.id)) {
          await check();
          if (destination === undefined) {
            const result = await call('saul_windows_create', {
              session: args.session,
              tabIds: [move.tabId],
              focused: false,
              dryRun: false,
            });
            if (!Number.isSafeInteger(result.windowId))
              throw new Error('Window creation outcome unknown');
            destination = result.windowId;
            expected = movedSnapshot(expected, move.tabId, destination);
          } else {
            const remaining = ordered(expected, destination).filter((t) => t.id !== move.tabId);
            const index =
              move.beforeId === undefined
                ? remaining.length
                : remaining.findIndex((t) => t.id === move.beforeId);
            if (index < 0) throw new Error('Move anchor no longer exists');
            await call('saul_tabs_move', {
              session: args.session,
              tabIds: [move.tabId],
              windowId: destination,
              index,
              dryRun: false,
            });
            expected = movedSnapshot(expected, move.tabId, destination, index);
          }
          completedMoves++;
          await check();
        }
        appliedWindows.push({ id: destination, title: window.title });
        destinations.set(window.id, destination);
      }
      // Move first so existing destinations retain their anchors until all moves
      // complete. Duplicate-only windows can then disappear without index drift.
      for (const duplicate of plan.duplicates) {
        await check();
        await call('saul_tabs_close_duplicates', {
          session: args.session,
          duplicates: [duplicate],
          dryRun: false,
        });
        expected = closedSnapshot(expected, duplicate.tabId);
        completedClosures++;
        await check();
      }
      const actual = await check();
      const titles = Object.fromEntries(
        actual.windows.filter((w) => w.title !== undefined).map((w) => [w.id, w.title]),
      );
      for (const window of appliedWindows)
        if (actual.windows.some((w) => w.id === window.id)) titles[window.id] = window.title;
      const windows = Object.entries(titles)
        .filter(
          ([id, title]) =>
            current.snapshot.nativeNames?.status !== 'available' ||
            actual.windows.find((w) => w.id === Number(id))?.title !== title,
        )
        .map(([id, title]) => ({
          windowId: Number(id),
          title,
          ...(actual.nativeNames?.status === 'available'
            ? { expectedTitle: actual.windows.find((w) => w.id === Number(id)).title }
            : {}),
        }));
      if (windows.length) {
        await call('saul_windows_label', { session: args.session, windows, dryRun: false });
        for (const window of expected.windows)
          if (titles[window.id] !== undefined) window.title = titles[window.id];
        await check();
      }
      // Retire helper-only labels after importing them into extension session state.
      labels.save(
        args.session,
        {},
        current.sessions.map((s) => s.session),
      );
      plan.projected = plan.projected.map((w) => ({
        ...w,
        id: destinations.get(w.id) ?? w.id,
      }));
      plan.status = 'applied';
      plan.receipt = {
        completedMoves,
        completedClosures,
        message: `Layout and labels applied and verified. ${completedClosures} duplicate tab${completedClosures === 1 ? '' : 's'} closed.`,
      };
    } catch (error) {
      plan.status = 'failed';
      plan.receipt = {
        completedMoves,
        completedClosures,
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
