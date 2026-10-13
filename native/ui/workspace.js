const $ = (id) => document.getElementById(id);
let data,
  approvalToken,
  mode = 'current',
  busy = false,
  refreshing = false,
  ready = false,
  capabilities = {},
  nextId = 0;
const pending = new Map();
let poll, draggedTab, selectedTab, pointerDrag, deferredResult, suppressClick;
let draftLayout,
  queuedEdit,
  staging = false,
  editSequence = 0,
  animateNextRender = false;
const fixed = (tab) => tab.pinned || tab.groupId >= 0;
const quantity = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;
const post = (message) => window.parent.postMessage({ jsonrpc: '2.0', ...message }, '*');
function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(
        new Error(
          'Connection timed out. Refresh to inspect the current state; do not retry an apply.',
        ),
      );
    }, 120000);
    pending.set(id, { resolve, reject, timer });
    post({ id, method, params });
  });
}
function status(message, error = false) {
  $('status').textContent = message;
  $('status').className = error ? 'error' : '';
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}
function domain(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'chrome-extension:') return 'Extension';
    if (parsed.protocol === 'chrome:') return 'Chrome';
    return parsed.hostname || parsed.protocol;
  } catch {
    return 'Local tab';
  }
}
function receive(result) {
  if (result?.isError)
    throw new Error(result.content?.[0]?.text || 'Saul could not complete the request');
  if (!result?.structuredContent || !('sessions' in result.structuredContent)) return;
  if (pointerDrag || draggedTab !== undefined) {
    deferredResult = result;
    return;
  }
  if (result._saulEditSequence === editSequence) draftLayout = undefined;
  const next = result.structuredContent;
  if (next.proposal?.id !== data?.proposal?.id && next.proposal?.status === 'pending')
    mode = 'proposed';
  const changed =
    JSON.stringify(next) !== JSON.stringify(data) || approvalToken !== result._meta?.approvalToken;
  data = next;
  if (!next.snapshot?.tabs.some((tab) => tab.id === selectedTab)) selectedTab = undefined;
  approvalToken = result._meta?.approvalToken;
  if (changed) render();
}
async function tool(name, args) {
  const result = await request('tools/call', { name, arguments: args });
  receive(result);
  return result;
}
function layout() {
  if (mode === 'proposed' && draftLayout) return draftLayout;
  const proposal = data?.proposal;
  if (mode === 'proposed' && proposal)
    return { source: proposal.before, windows: proposal.projected };
  const source = data?.snapshot;
  return {
    source,
    windows: (source?.windows ?? []).map((window, index) => ({
      id: window.id,
      title: window.title || `Window ${index + 1}`,
      tabIds: source.tabs
        .filter((tab) => tab.windowId === window.id)
        .sort((a, b) => a.index - b.index)
        .map((tab) => tab.id),
    })),
  };
}
function canEdit() {
  return Boolean(
    ready &&
      !busy &&
      data?.snapshot &&
      (mode === 'current' ||
        (draftLayout
          ? draftLayout.revision === data.revision
          : ['pending', 'expired'].includes(data.proposal?.status))),
  );
}
function endDrag() {
  if (pointerDrag) {
    cancelAnimationFrame(pointerDrag.frame);
    pointerDrag.ghost?.remove();
    pointerDrag.indicator?.remove();
  }
  document.body.classList.remove('is-dragging');
  draggedTab = undefined;
  pointerDrag = undefined;
  document.querySelectorAll('.dragging, .drop-target').forEach((node) => {
    node.classList.remove('dragging', 'drop-target');
  });
  if (deferredResult) {
    const result = deferredResult;
    deferredResult = undefined;
    receive(result);
  }
}
function dragDestination(x, y) {
  const hit = document.elementFromPoint(x, y);
  const card = hit?.closest('[data-drop-window]');
  if (!card) return;
  if (card.id === 'new-window') return { destination: 'new', card, label: 'Create a new window' };
  const { source, windows } = layout();
  const window = windows.find((w) => String(w.id) === card.dataset.dropWindow);
  if (!window) return;
  const ids = window.tabIds.filter(
    (id) => id !== draggedTab && !fixed(source.tabs.find((t) => t.id === id)),
  );
  const list = card.querySelector('.tabs');
  const rows = [...list.querySelectorAll('.tab[data-movable="true"]')].filter(
    (row) => Number(row.dataset.tabId) !== draggedTab,
  );
  const bounds = list.getBoundingClientRect();
  let beforeId,
    markerY = bounds.bottom;
  const footer = hit.closest('.window-end');
  if (hit.closest('.window-head')) {
    beforeId = ids[0];
    const first = rows[0]?.getBoundingClientRect();
    markerY = first ? Math.max(bounds.top, first.top) : bounds.bottom;
  } else if (!footer) {
    const next = rows.find((row) => {
      const rect = row.getBoundingClientRect();
      return y < rect.top + rect.height / 2;
    });
    if (next) {
      beforeId = Number(next.dataset.tabId);
      markerY = next.getBoundingClientRect().top;
    } else if (rows.length) {
      const last = rows.at(-1);
      beforeId = ids[ids.indexOf(Number(last.dataset.tabId)) + 1];
      markerY = last.getBoundingClientRect().bottom;
    }
  }
  markerY = Math.max(bounds.top, Math.min(bounds.bottom, markerY));
  const index = beforeId === undefined ? ids.length : ids.indexOf(beforeId);
  return {
    destination: window.id,
    beforeId,
    card,
    list,
    markerY,
    label: `${window.title} · ${index === ids.length ? 'at the end' : `position ${index + 1}`}`,
  };
}
function updateDrag() {
  const drag = pointerDrag;
  if (!drag?.ghost) return;
  const { x, y } = drag;
  drag.ghost.style.transform = `translate3d(${Math.min(x + 16, innerWidth - drag.ghost.offsetWidth - 8)}px, ${Math.max(8, Math.min(y + 14, innerHeight - drag.ghost.offsetHeight - 8))}px, 0)`;
  const target = dragDestination(x, y);
  if (drag.target?.card !== target?.card) {
    drag.target?.card.classList.remove('drop-target');
    target?.card.classList.add('drop-target');
  }
  drag.target = target;
  drag.badge.textContent = target ? target.label : 'Outside a window · release to cancel';
  drag.ghost.classList.toggle('invalid-drop', !target);
  drag.indicator.hidden = !target?.list;
  if (target?.list) {
    const rect = target.list.getBoundingClientRect();
    Object.assign(drag.indicator.style, {
      left: `${rect.left + 8}px`,
      top: `${target.markerY - 6}px`,
      width: `${rect.width - 16}px`,
    });
  }
}
function startDrag(item, tabId) {
  draggedTab = tabId;
  item.classList.add('dragging');
  document.body.classList.add('is-dragging');
  const ghost = item.cloneNode(true);
  ghost.className = 'tab drag-ghost';
  ghost.removeAttribute('data-tab-id');
  ghost.removeAttribute('data-focus-key');
  ghost.removeAttribute('title');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.querySelectorAll('button').forEach((button) => button.remove());
  ghost.style.width = `${Math.min(320, item.getBoundingClientRect().width)}px`;
  const badge = element('div', 'drag-destination');
  ghost.append(badge);
  const indicator = element('div', 'drop-indicator');
  indicator.setAttribute('aria-hidden', 'true');
  document.body.append(ghost, indicator);
  Object.assign(pointerDrag, { ghost, indicator, badge, previousTime: performance.now() });
  status('Drag to a gap or another window. Escape cancels.');
  updateDrag();
  const tick = (time) => {
    const drag = pointerDrag;
    if (!drag?.ghost) return;
    const elapsed = Math.min(32, time - drag.previousTime);
    drag.previousTime = time;
    const hit = document.elementFromPoint(drag.x, drag.y);
    const list = hit?.closest('.tabs');
    const velocity = (position, start, end) => {
      const edge = Math.min(56, (end - start) / 3);
      if (position < start + edge) return -14 * Math.min(1, (start + edge - position) / edge) ** 2;
      if (position > end - edge) return 14 * Math.min(1, (position - end + edge) / edge) ** 2;
      return 0;
    };
    if (list) {
      const rect = list.getBoundingClientRect();
      list.scrollTop += (velocity(drag.y, rect.top, rect.bottom) * elapsed) / 16;
    }
    window.scrollBy(0, (velocity(drag.y, 0, innerHeight) * elapsed) / 16);
    updateDrag();
    drag.frame = requestAnimationFrame(tick);
  };
  pointerDrag.frame = requestAnimationFrame(tick);
}
function pointerSource(item, tabId) {
  item.addEventListener('pointerdown', (event) => {
    if (
      !canEdit() ||
      event.button !== 0 ||
      !event.isPrimary ||
      event.target.closest('button:not(.move-handle), input, select')
    )
      return;
    const handle = event.target.closest('.move-handle');
    // Let touch users scroll normally on the row; the grip is their drag surface.
    if (event.pointerType === 'touch' && !handle) return;
    if (!handle) event.preventDefault();
    pointerDrag = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      item,
      tabId,
    };
    (handle || item).setPointerCapture(event.pointerId);
  });
  item.addEventListener('pointermove', (event) => {
    const drag = pointerDrag;
    if (!drag || drag.id !== event.pointerId) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (draggedTab === undefined && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= 6)
      startDrag(item, tabId);
  });
  item.addEventListener('pointerup', (event) => {
    if (pointerDrag?.id !== event.pointerId) return;
    pointerDrag.x = event.clientX;
    pointerDrag.y = event.clientY;
    updateDrag();
    const target = pointerDrag.target;
    const moved = draggedTab !== undefined;
    suppressClick = moved ? tabId : undefined;
    if (moved)
      setTimeout(() => {
        suppressClick = undefined;
      }, 0);
    endDrag();
    if (moved && target) void moveTab(tabId, target.destination, target.beforeId);
    else if (moved) status('Move cancelled. The preview is unchanged.');
  });
  item.addEventListener('pointercancel', endDrag);
  item.addEventListener('lostpointercapture', () => {
    if (pointerDrag) endDrag();
  });
}
async function moveTab(tabId, destination, beforeId) {
  if (!canEdit()) return;
  const { source, windows } = layout();
  const tab = source.tabs.find((item) => item.id === tabId);
  if (!tab || fixed(tab) || beforeId === tabId) return;
  const draft = windows.map((window) => ({ ...window, tabIds: [...window.tabIds] }));
  const origin = draft.find((window) => window.tabIds.includes(tabId));
  let target = draft.find((window) => String(window.id) === String(destination));
  if (!origin || (!target && destination !== 'new')) return;
  if (!target) {
    let title = 'New window';
    let number = 2;
    while (draft.some((window) => window.title === title)) title = `New window ${number++}`;
    target = { title, tabIds: [] };
    draft.push(target);
  }
  origin.tabIds = origin.tabIds.filter((id) => id !== tabId);
  const index = beforeId === undefined ? target.tabIds.length : target.tabIds.indexOf(beforeId);
  if (index < 0 || (beforeId !== undefined && fixed(source.tabs.find((t) => t.id === beforeId))))
    return;
  target.tabIds.splice(index, 0, tabId);
  if (JSON.stringify(draft) === JSON.stringify(windows)) return;
  await stageDraft(source, draft);
}
async function stageDraft(source, draft) {
  const args = {
    session: data.session,
    revision: data.revision,
    summary: 'Your manual layout. Review the highlighted changes before applying.',
    windows: draft
      .map((window) => ({
        ...(typeof window.id === 'number' &&
        source.tabs.some(
          (tab) => tab.windowId === window.id && (fixed(tab) || window.tabIds.includes(tab.id)),
        )
          ? { windowId: window.id }
          : {}),
        title: window.title,
        tabIds: window.tabIds.filter((id) => !fixed(source.tabs.find((t) => t.id === id))),
      }))
      .filter(
        (window) =>
          window.tabIds.length ||
          source.tabs.some((tab) => fixed(tab) && tab.windowId === window.windowId),
      ),
  };
  const sequence = ++editSequence;
  draftLayout = {
    source,
    revision: data.revision,
    windows: draft
      .map((window, i) => ({
        ...window,
        id: window.id ?? `new-${i + 1}`,
        tabIds: [...window.tabIds],
      }))
      .filter((window) => window.tabIds.length),
  };
  mode = 'proposed';
  approvalToken = undefined;
  queuedEdit = { args, sequence };
  animateNextRender = true;
  const alreadyStaging = staging;
  staging = true;
  render();
  status('Saving preview… You can keep arranging tabs.');
  if (alreadyStaging) return;
  try {
    while (queuedEdit) {
      const edit = queuedEdit;
      queuedEdit = undefined;
      const result = await request('tools/call', {
        name: 'saul_workspace_propose',
        arguments: edit.args,
      });
      if (result?.isError) throw new Error(result.content?.[0]?.text || 'Unable to save preview');
      result._saulEditSequence = edit.sequence;
      receive(result);
    }
    status(
      data.proposal
        ? 'Preview updated. Continue arranging tabs, or apply when ready.'
        : 'Layout matches Chrome. No changes to apply.',
    );
  } catch (error) {
    // Keep the visible draft, but never enable apply with an unvalidated layout.
    queuedEdit = undefined;
    approvalToken = undefined;
    status(`${error.message}. Your draft is retained; renew the preview to retry.`, true);
  } finally {
    staging = false;
    if (!pointerDrag) render();
  }
}
function displayProposal() {
  if (!draftLayout) return data?.proposal;
  const { source, windows } = draftLayout;
  const changedTabIds = windows.flatMap((window) =>
    window.tabIds.filter((id, index) => {
      const tab = source.tabs.find((t) => t.id === id);
      return tab.windowId !== window.id || tab.index !== index;
    }),
  );
  return {
    ...data?.proposal,
    status: draftLayout.revision === data.revision ? 'pending' : 'stale',
    receipt: undefined,
    summary: 'Your manual layout. Review before applying.',
    changedTabIds,
    projected: windows,
    before: source,
    expiresAt: 0,
  };
}

function renderMoveControls(source, windows, editable) {
  const selected = source?.tabs.find((tab) => tab.id === selectedTab);
  $('move-controls').hidden = !selected;
  if (selected) {
    $('moving-title').textContent = `Move “${selected.title || 'Untitled tab'}”`;
    const previous = $('destination').value;
    $('destination').replaceChildren(
      ...[...windows, { id: 'new', title: 'New window' }].map((window) => {
        const option = element('option', '', window.title);
        option.value = window.id;
        return option;
      }),
    );
    if ([...$('destination').options].some((option) => option.value === previous))
      $('destination').value = previous;
    for (const id of ['destination', 'move-tab', 'move-up', 'move-down'])
      $(id).disabled = !editable;
    const siblings =
      windows
        .find((window) => window.tabIds.includes(selectedTab))
        ?.tabIds.filter((id) => !fixed(source.tabs.find((tab) => tab.id === id))) ?? [];
    $('move-up').disabled ||= siblings.indexOf(selectedTab) <= 0;
    $('move-down').disabled ||= siblings.indexOf(selectedTab) === siblings.length - 1;
  }
}

function renameWindow(head, button, window) {
  const heading = head.querySelector('h2');
  const input = element('input', 'window-label');
  input.value = window.title;
  input.maxLength = 1000;
  input.setAttribute('aria-label', 'Window label');
  heading.replaceWith(input);
  button.textContent = 'Save label';
  const cancel = () => {
    input.replaceWith(heading);
    button.textContent = 'Rename';
    button.onclick = () => renameWindow(head, button, window);
    button.focus({ preventScroll: true });
  };
  const save = () => {
    const title = input.value.trim();
    if (!title) return input.focus();
    cancel();
    if (title === window.title) return;
    const current = layout();
    void stageDraft(
      current.source,
      current.windows.map((item) => ({
        ...item,
        title: item.id === window.id ? title : item.title,
      })),
    );
  };
  button.onclick = save;
  input.onkeydown = (event) => {
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Enter') save();
    else cancel();
  };
  input.focus();
  input.select();
}

function renderProposal(proposal, snapshot) {
  const panel = $('proposal');
  panel.hidden = !proposal;
  const detailsOpen = panel.querySelector('details')?.open ?? false;
  panel.replaceChildren();
  if (!proposal) return;
  const pending = ['pending', 'expired'].includes(proposal.status);
  const valid = proposal.status === 'pending' && proposal.expiresAt > Date.now();
  const title = element('div', 'proposal-title');
  title.append(
    element(
      'h2',
      '',
      proposal.status === 'pending'
        ? draftLayout
          ? 'Updating preview…'
          : 'Ready for your review'
        : `Proposal ${proposal.status}`,
    ),
    element(
      'p',
      'muted',
      `${quantity(proposal.changedTabIds.length, 'tab')} affected · ${quantity(proposal.projected.length, 'window')}`,
    ),
  );
  const detail = element('details');
  detail.open = detailsOpen;
  detail.append(element('summary', '', 'Plan details'), element('p', '', proposal.summary));
  const row = element('div', 'row');
  row.append(
    element(
      'span',
      'muted',
      proposal.receipt?.message ||
        (!pending
          ? 'This preview is out of date. Switch to Current to start again.'
          : draftLayout
            ? staging
              ? 'Checking your draft. You can keep arranging.'
              : 'Draft not validated. Renew the preview to retry.'
            : valid
              ? 'Chrome changes only when you apply.'
              : 'Preview expired. Renew to apply.'),
    ),
  );
  const apply = element('button', 'primary', 'Apply changes to Chrome');
  apply.id = 'apply';
  apply.disabled =
    !valid || !approvalToken || busy || staging || Boolean(draftLayout) || refreshing || !snapshot;
  apply.onclick = applyPlan;
  row.append(apply);
  if (!valid && !staging && pending) {
    const renew = element('button', '', 'Renew preview');
    renew.disabled = busy || refreshing || !snapshot;
    renew.onclick = () => {
      const { source, windows } = layout();
      void stageDraft(source, windows);
    };
    row.append(renew);
  }
  panel.append(title, row, detail);
}

function render() {
  const focusKey = document.activeElement?.dataset.focusKey;
  const oldBoardTop = $('board').getBoundingClientRect().top;
  const oldRects = new Map(
    [...document.querySelectorAll('.tab')].map((node) => [
      node.dataset.tabId,
      node.getBoundingClientRect(),
    ]),
  );
  const oldCards = new Map(
    [...document.querySelectorAll('.window')].map((node) => [node.dataset.windowId, node]),
  );
  const scroll = new Map(
    [...document.querySelectorAll('.tabs')].map((list) => [list.dataset.windowId, list.scrollTop]),
  );
  const snapshot = data?.snapshot;
  const proposal = displayProposal();
  $('refresh').disabled = !ready || busy || staging || refreshing;
  $('ask').disabled = !ready || busy || staging || refreshing || !snapshot || !capabilities.message;
  $('session').disabled = busy || staging || refreshing || !data?.sessions?.length;
  $('session').replaceChildren(
    ...(data?.sessions ?? []).map((s) => {
      const option = element(
        'option',
        '',
        `${s.session.slice(0, 8)} · ${s.extensionId.slice(0, 8)}`,
      );
      option.value = s.session;
      option.selected = s.session === data.session;
      return option;
    }),
  );
  if (!data?.session) {
    const option = element('option', '', 'Select a browser');
    option.value = '';
    option.selected = true;
    $('session').prepend(option);
  }
  $('session-picker').hidden = data?.sessions?.length === 1 && Boolean(data.session);
  $('layout-view').hidden = !proposal;
  $('counts').textContent = snapshot
    ? `${quantity(snapshot.windows.length, 'window')} · ${quantity(snapshot.tabs.length, 'tab')}`
    : '';
  $('current').disabled = busy || refreshing;
  $('proposed').disabled = !proposal || busy || refreshing;
  if (!proposal) mode = 'current';
  $('current').setAttribute('aria-pressed', String(mode === 'current'));
  $('proposed').setAttribute('aria-pressed', String(mode === 'proposed'));
  renderProposal(proposal, snapshot);
  const { source, windows } = layout();
  const editable = canEdit();
  const filter = $('filter').value.toLowerCase();
  const tabMap = new Map(source?.tabs.map((t) => [t.id, t]) ?? []);
  const cards = windows
    .map((w) => {
      const tabs = w.tabIds
        .map((id) => tabMap.get(id))
        .filter(Boolean)
        .filter((t) => `${t.title} ${t.url}`.toLowerCase().includes(filter));
      if (!tabs.length && filter) return null;
      const signature = JSON.stringify([
        w.title,
        w.tabIds,
        tabs,
        source.groups,
        tabs.map((t) => proposal?.changedTabIds.includes(t.id)),
        editable,
        tabs.some((tab) => tab.id === selectedTab) ? selectedTab : undefined,
        filter,
      ]);
      const old = oldCards.get(String(w.id));
      if (old?.dataset.signature === signature) return old;
      const card = element('section', 'window');
      card.dataset.signature = signature;
      card.dataset.windowId = w.id;
      card.dataset.dropWindow = w.id;
      const head = element('div', 'window-head');
      head.append(
        element('h2', '', w.title || `Window ${w.id}`),
        element('span', '', quantity(w.tabIds.length, 'tab')),
      );
      const rename = element('button', 'rename-window', 'Rename');
      rename.disabled = !editable;
      rename.setAttribute('aria-label', `Rename window: ${w.title}`);
      rename.onclick = () => renameWindow(head, rename, w);
      head.append(rename);
      const list = element('ol', 'tabs');
      list.dataset.windowId = w.id;
      for (const tab of tabs) {
        const changed = mode === 'proposed' && proposal.changedTabIds.includes(tab.id);
        const item = element('li', `tab${changed ? ' changed' : ''}`);
        item.title = `${tab.title || 'Untitled tab'}\n${tab.url}`;
        item.dataset.tabId = tab.id;
        item.draggable = false;
        item.dataset.movable = String(Boolean(editable && !fixed(tab)));
        if (!fixed(tab) && editable) pointerSource(item, tab.id);
        const name = domain(tab.url);
        const text = element('div');
        const title = element('div', 'tab-title', tab.title || 'Untitled tab');
        const group = source.groups.find((g) => g.id === tab.groupId);
        text.append(
          title,
          element(
            'div',
            'tab-detail',
            `${name}${
              changed
                ? w.id === tab.windowId
                  ? ' · reordered'
                  : ` · from Window ${source.windows.findIndex((window) => window.id === tab.windowId) + 1}`
                : ''
            }`,
          ),
        );
        const detail = text.querySelector('.tab-detail');
        if (tab.pinned) detail.append(element('span', 'tag', 'Pinned'));
        if (group) detail.append(element('span', 'tag', group.title || 'Group'));
        item.append(text);
        if (!fixed(tab)) {
          const move = element('button', 'move-handle', '⠿');
          move.setAttribute('aria-label', `Move tab: ${tab.title || 'Untitled tab'}`);
          move.setAttribute('aria-pressed', String(selectedTab === tab.id));
          move.dataset.focusKey = `move-${tab.id}`;
          move.disabled = !editable;
          move.onclick = (event) => {
            if (suppressClick === tab.id && event.detail > 0) {
              suppressClick = undefined;
              return;
            }
            selectedTab = selectedTab === tab.id ? undefined : tab.id;
            render();
            if (selectedTab !== undefined) $('destination').focus();
          };
          item.append(move);
        }
        list.append(item);
      }
      const end = element('div', 'window-end', 'Drop at end');
      end.hidden = !editable;
      card.append(head, list, end);
      return card;
    })
    .filter(Boolean);
  const children = cards.length
    ? cards
    : [
        element(
          'div',
          'empty',
          !data?.sessions?.length
            ? 'No Chrome session connected. Open Saul → Tabs and enable Codex tab access, then refresh.'
            : !snapshot
              ? 'Select the Chrome session you want to organize.'
              : 'No matching tabs.',
        ),
      ];
  if (editable) {
    let newWindow = $('new-window');
    if (!newWindow) {
      newWindow = element('div', 'new-window', '+ New window');
      newWindow.id = 'new-window';
      newWindow.append(element('span', '', 'Drop a tab here to preview a new window'));
      newWindow.dataset.dropWindow = 'new';
    }
    children.push(newWindow);
  }
  // Keep unchanged cards attached: a preview acknowledgement must not interrupt
  // a new gesture or reset scroll/focus while the user is already arranging again.
  let next = $('board').firstChild;
  for (const child of children) {
    if (child === next) next = next.nextSibling;
    else $('board').insertBefore(child, next);
  }
  while (next) {
    const obsolete = next;
    next = next.nextSibling;
    obsolete.remove();
  }
  renderMoveControls(source, windows, editable);
  for (const list of document.querySelectorAll('.tabs'))
    list.scrollTop = scroll.get(list.dataset.windowId) ?? 0;
  // Anchor the board when the review bar appears; retain each window's scroll position.
  if (oldCards.size && !pointerDrag)
    window.scrollBy(0, $('board').getBoundingClientRect().top - oldBoardTop);
  if (animateNextRender && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (const node of document.querySelectorAll('.tab')) {
      const old = oldRects.get(node.dataset.tabId);
      const next = node.getBoundingClientRect();
      if (!old || Math.abs(old.x - next.x) + Math.abs(old.y - next.y) < 1) continue;
      node.animate(
        [
          { transform: `translate(${old.x - next.x}px, ${old.y - next.y}px)` },
          { transform: 'translate(0, 0)' },
        ],
        { duration: 160, easing: 'cubic-bezier(.2,.8,.2,1)' },
      );
    }
  }
  animateNextRender = false;
  if (focusKey)
    document.querySelector(`[data-focus-key="${focusKey}"]`)?.focus({ preventScroll: true });
  if (data?.error) status(data.error, true);
}
async function refresh() {
  if (busy || staging || refreshing || !ready || pointerDrag || draggedTab !== undefined) return;
  refreshing = true;
  $('refresh').disabled = true;
  try {
    await tool('saul_workspace_state', data?.session ? { session: data.session } : {});
    status(data?.error || 'Connected · Updated just now', Boolean(data?.error));
  } catch (error) {
    approvalToken = undefined;
    status(error.message, true);
  } finally {
    refreshing = false;
    if (!pointerDrag && draggedTab === undefined) render();
  }
}
async function applyPlan() {
  if (
    busy ||
    staging ||
    draftLayout ||
    refreshing ||
    !approvalToken ||
    data?.proposal?.status !== 'pending'
  )
    return;
  const args = { session: data.session, proposalId: data.proposal.id, approvalToken };
  busy = true;
  approvalToken = undefined;
  render();
  status('Applying the reviewed layout…');
  try {
    await tool('saul_workspace_apply', args);
    status(data.proposal.receipt?.message || 'Finished', data.proposal.status !== 'applied');
    mode = 'current';
  } catch (error) {
    approvalToken = undefined;
    status(error.message, true);
  } finally {
    busy = false;
    render();
  }
}
$('refresh').onclick = refresh;
$('move-tab').onclick = () => void moveTab(selectedTab, $('destination').value);
function cancelMove() {
  const key = selectedTab;
  selectedTab = undefined;
  render();
  document.querySelector(`[data-focus-key="move-${key}"]`)?.focus();
}
$('cancel-move').onclick = cancelMove;
for (const [id, direction] of [
  ['move-up', -1],
  ['move-down', 1],
]) {
  $(id).onclick = () => {
    const { source, windows } = layout();
    const window = windows.find((item) => item.tabIds.includes(selectedTab));
    const siblings = window.tabIds.filter(
      (tabId) => !fixed(source.tabs.find((tab) => tab.id === tabId)),
    );
    const index = siblings.indexOf(selectedTab);
    void moveTab(selectedTab, window.id, siblings[index + (direction < 0 ? -1 : 2)]);
  };
}

$('session').onchange = async () => {
  draftLayout = undefined;
  selectedTab = undefined;
  data = { ...data, session: $('session').value || undefined, snapshot: null, proposal: null };
  approvalToken = undefined;
  await refresh();
};
$('current').onclick = () => {
  mode = 'current';
  render();
};
$('proposed').onclick = () => {
  mode = 'proposed';
  render();
};
$('filter').oninput = render;
window.addEventListener('blur', endDrag);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && pointerDrag) {
    endDrag();
    status('Drag cancelled. The preview is unchanged.');
  } else if (event.key === 'Escape' && selectedTab !== undefined) cancelMove();
});
$('ask').onclick = async () => {
  const goal = $('request').value.trim();
  if (!goal) {
    $('request').focus();
    return;
  }
  busy = true;
  render();
  try {
    const text = `Use Saul to propose a window/tab reorganization for browser session ${data.session}. My request: ${goal}\nCall saul_workspace_show for fresh inventory, then saul_workspace_propose with its revision. Preserve pinned tabs and existing groups. Show a dry run in the board and wait for me to click Apply changes to Chrome. Do not execute individual mutations.`;
    const result = await request('ui/message', { role: 'user', content: [{ type: 'text', text }] });
    if (result?.isError) throw new Error('Codex could not accept the request');
    $('composer').open = false;
    $('composer').querySelector('summary').focus();
    status('Request sent. The proposed layout will appear here for review.');
  } catch (error) {
    status(error.message, true);
  } finally {
    busy = false;
    render();
  }
};
window.addEventListener('message', (event) => {
  if (event.source !== window.parent || event.data?.jsonrpc !== '2.0') return;
  const message = event.data;
  const item = pending.get(message.id);
  if (item) {
    clearTimeout(item.timer);
    pending.delete(message.id);
    if (message.error) item.reject(new Error(message.error.message));
    else item.resolve(message.result);
    return;
  }
  if (message.method === 'ui/notifications/tool-result') {
    try {
      receive(message.params);
    } catch (error) {
      status(error.message, true);
    }
  }
  if (message.method === 'ui/notifications/host-context-changed' && message.params?.theme)
    document.documentElement.dataset.theme = message.params.theme;
  if (message.method === 'ui/resource-teardown') {
    clearInterval(poll);
    endDrag();
    for (const item of pending.values()) clearTimeout(item.timer);
    pending.clear();
    post({ id: message.id, result: {} });
  }
});
try {
  const init = await request('ui/initialize', {
    appInfo: { name: 'Saul workspace', version: '1.1.0' },
    appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
    protocolVersion: '2026-01-26',
  });
  capabilities = init.hostCapabilities ?? {};
  if (init.hostContext?.theme) document.documentElement.dataset.theme = init.hostContext.theme;
  ready = true;
  post({ method: 'ui/notifications/initialized', params: {} });
  render();
  await refresh();
  if (!capabilities.message)
    status('This host cannot send messages. Ask Codex in chat to propose a Saul layout.');
  poll = setInterval(() => {
    if (
      !document.hidden &&
      !draftLayout &&
      selectedTab === undefined &&
      !document.activeElement?.closest('#board, #session, #proposal, #move-controls')
    )
      void refresh();
  }, 10000);
  new ResizeObserver(() =>
    post({
      method: 'ui/notifications/size-changed',
      params: { height: Math.min(document.documentElement.scrollHeight, 1200) },
    }),
  ).observe(document.body);
} catch (error) {
  status(`Open this view through the Saul MCP tool in Codex. ${error.message}`, true);
}
