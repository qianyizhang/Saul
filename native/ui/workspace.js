const $ = (id) => document.getElementById(id);
const minimumModeKey = 'saul-board-minimum-mode';
function setMinimumMode(value) {
  document.documentElement.dataset.minimum = String(value);
  $('minimum-mode').checked = value;
}
try {
  setMinimumMode(localStorage.getItem(minimumModeKey) !== 'false');
} catch {
  setMinimumMode(true);
}
$('minimum-mode').onchange = () => {
  const value = $('minimum-mode').checked;
  setMinimumMode(value);
  try {
    localStorage.setItem(minimumModeKey, String(value));
    $('preference-error').hidden = true;
  } catch {
    $('preference-error').textContent = 'Changed for this view. The preference could not be saved.';
    $('preference-error').hidden = false;
  }
};
let data,
  approvalToken,
  interactionToken,
  busy = false,
  refreshing = false,
  ready = false,
  capabilities = {},
  nextId = 0;
const pending = new Map();
let poll, draggedTab, selectedTab, pointerDrag, deferredResult;
const selection = new Set();
let selectedGroup;
const foldedWindows = new Set();
let windowOrder = [],
  windowDrag,
  contextMenu;
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
  if (pointerDrag || windowDrag || draggedTab !== undefined) {
    deferredResult = result;
    return;
  }
  if (result._saulEditSequence === editSequence) draftLayout = undefined;
  const next = result.structuredContent;
  const changed =
    JSON.stringify(next) !== JSON.stringify(data) || approvalToken !== result._meta?.approvalToken;
  data = next;
  if (!next.snapshot?.tabs.some((tab) => tab.id === selectedTab)) selectedTab = undefined;
  approvalToken = result._meta?.approvalToken;
  interactionToken = result._meta?.interactionToken;
  for (const id of selection)
    if (!next.snapshot?.tabs.some((t) => t.id === id)) selection.delete(id);
  if (changed) render();
}
async function tool(name, args) {
  const result = await request('tools/call', { name, arguments: args });
  receive(result);
  return result;
}
function layout(current = false) {
  if (!current && draftLayout) return draftLayout;
  const proposal = data?.proposal;
  if (!current && proposal && ['pending', 'expired'].includes(proposal.status))
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
      !['pending', 'expired'].includes(data?.proposal?.status) &&
      !draftLayout,
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
    (id) => id !== draggedTab && !source.tabs.find((t) => t.id === id).pinned,
  );
  const groupHead = hit.closest('[data-group-id]');
  if (groupHead)
    return {
      destination: window.id,
      groupId: Number(groupHead.dataset.groupId),
      card,
      label: window.title + ' · ' + groupHead.textContent,
    };
  const list = card.querySelector('.tabs');
  const rows = [...list.querySelectorAll('.tab[data-movable="true"]')].filter(
    (row) => Number(row.dataset.tabId) !== draggedTab,
  );
  const bounds = list.getBoundingClientRect();
  let beforeId,
    markerY = bounds.bottom;
  const footer = hit.closest('.window-end');
  if (list.hidden) return { destination: window.id, card, label: `${window.title} · at the end` };
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
    groupId:
      beforeId === undefined
        ? undefined
        : source.tabs.find((t) => t.id === beforeId)?.groupId >= 0
          ? source.tabs.find((t) => t.id === beforeId).groupId
          : undefined,
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
function pointerSource(item, tabId, sourceGroupId) {
  item.addEventListener('pointerdown', (event) => {
    if (
      !canEdit() ||
      event.button !== 0 ||
      !event.isPrimary ||
      event.target.closest('button, input, select')
    )
      return;
    // Touch scrolling stays native; number buttons expose tap-based moves.
    if (event.pointerType === 'touch') return;
    event.preventDefault();
    pointerDrag = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      item,
      tabId,
    };
    item.setPointerCapture(event.pointerId);
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
    endDrag();
    if (moved && target)
      void moveTab(tabId, target.destination, target.beforeId, target.groupId, sourceGroupId);
    else if (moved) status('Move cancelled.');
    else if (sourceGroupId === undefined) {
      if (selection.has(tabId)) selection.delete(tabId);
      else selection.add(tabId);
      selectedTab = tabId;
      selectedGroup = undefined;
      render();
    }
  });
  item.addEventListener('pointercancel', endDrag);
  item.addEventListener('lostpointercapture', () => {
    if (pointerDrag) endDrag();
  });
}
function selectedIds(source = data.snapshot) {
  const order = windowOrder.length ? windowOrder : source.windows.map((w) => String(w.id));
  return [...source.tabs]
    .sort(
      (a, b) =>
        order.indexOf(String(a.windowId)) - order.indexOf(String(b.windowId)) || a.index - b.index,
    )
    .filter((t) => selection.has(t.id))
    .map((t) => t.id);
}
async function manual(name, args = {}) {
  if (busy || !interactionToken) return;
  busy = true;
  render();
  status('');
  try {
    const result = await tool(name, { session: data.session, interactionToken, ...args });
    $('manual-notice').textContent = result.structuredContent.notice || '';
    $('group-form').hidden = true;
  } catch (error) {
    status(error.message, true);
    try {
      await tool('saul_workspace_state', { session: data.session });
    } catch {
      /* Keep original error. */
    }
  } finally {
    busy = false;
    render();
  }
}
async function moveTab(tabId, destination, beforeId, groupId, sourceGroupId) {
  if (!canEdit()) return;
  const tab = data.snapshot.tabs.find((t) => t.id === tabId);
  if (!tab || tab.pinned) return;
  const ids =
    sourceGroupId !== undefined
      ? data.snapshot.tabs.filter((t) => t.groupId === sourceGroupId).map((t) => t.id)
      : selection.has(tabId)
        ? selectedIds()
        : [tabId];
  if (ids.includes(beforeId) || (sourceGroupId !== undefined && groupId === sourceGroupId)) return;
  if (sourceGroupId !== undefined && groupId !== undefined)
    beforeId = data.snapshot.tabs
      .filter((t) => t.groupId === groupId)
      .sort((a, b) => a.index - b.index)[0]?.id;
  await manual('saul_workspace_edit', {
    revision: data.revision,
    kind: sourceGroupId !== undefined ? 'moveGroup' : 'move',
    ...(sourceGroupId !== undefined
      ? { groupId: sourceGroupId }
      : { tabIds: ids, ...(groupId === undefined ? {} : { groupId }) }),
    windowId: destination === 'new' ? -1 : Number(destination),
    ...(beforeId === undefined ? {} : { beforeTabId: beforeId }),
  });
}
async function stageDraft(
  source,
  draft,
  deduplicate = data?.proposal?.deduplicate ?? false,
  movedTabId,
) {
  const submitted = draft.map((w) => ({ ...w, tabIds: [...w.tabIds] }));
  // A deduplicated projection hides removed copies. Retain those inputs while
  // editing or opting out so the server still validates complete tab coverage.
  for (const duplicate of ['pending', 'expired'].includes(data?.proposal?.status)
    ? (data.proposal.duplicates ?? [])
    : []) {
    if (submitted.some((w) => w.tabIds.includes(duplicate.tabId))) continue;
    const destination = submitted.find((w) => w.tabIds.includes(duplicate.keepTabId));
    if (destination) destination.tabIds.push(duplicate.tabId);
  }
  const args = {
    session: data.session,
    revision: data.revision,
    summary: data?.proposal?.summary || 'Window name change',
    deduplicate,
    windows: submitted
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
    changedTabIds: [
      ...new Set([
        ...(draftLayout?.changedTabIds ??
          (['pending', 'expired'].includes(data?.proposal?.status)
            ? data.proposal.changedTabIds
            : [])),
        ...(movedTabId === undefined ? [] : [movedTabId]),
      ]),
    ],
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
  approvalToken = undefined;
  queuedEdit = { args, sequence };
  animateNextRender = true;
  const alreadyStaging = staging;
  staging = true;
  render();
  status('');
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
    status('');
  } catch (error) {
    // Keep the visible draft, but never enable apply with an unvalidated layout.
    queuedEdit = undefined;
    approvalToken = undefined;
    status(`${error.message}. Draft retained. Choose Retry.`, true);
  } finally {
    staging = false;
    if (!pointerDrag) render();
  }
}
function displayProposal() {
  if (!draftLayout) return data?.proposal;
  const { source, windows } = draftLayout;
  return {
    ...data?.proposal,
    status: draftLayout.revision === data.revision ? 'pending' : 'stale',
    receipt: undefined,
    summary: data?.proposal?.summary || 'Window name change',
    changedTabIds: draftLayout.changedTabIds,
    projected: windows,
    before: source,
    expiresAt: 0,
  };
}

function windowIdentity(source, id, windows) {
  const ids = [
    ...source.windows.map((w) => w.id),
    ...windows.filter((w) => !source.windows.some((s) => s.id === w.id)).map((w) => w.id),
  ];
  const index = ids.indexOf(id);
  const colors = [
    'var(--design-color-primary)',
    'var(--design-color-window-blue)',
    'var(--design-color-window-violet)',
    'var(--design-color-warning)',
    'var(--design-color-window-rose)',
  ];
  return { index: index + 1, color: colors[Math.max(0, index) % colors.length] };
}
function toggleFold(id) {
  const key = String(id);
  if (foldedWindows.has(key)) foldedWindows.delete(key);
  else foldedWindows.add(key);
  render();
}
function closeActions(restore = false) {
  if (!contextMenu) return;
  const { node, anchor } = contextMenu;
  node.remove();
  contextMenu = undefined;
  if (restore) anchor.focus({ preventScroll: true });
}
function openActions(anchor, actions, point) {
  closeActions();
  const menu = element('div', 'context-menu');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Actions');
  for (const [label, action, disabled = false] of actions) {
    const button = element('button', '', label);
    button.setAttribute('role', 'menuitem');
    button.disabled = disabled;
    button.onclick = () => {
      closeActions();
      action();
    };
    menu.append(button);
  }
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(point?.x ?? rect.left, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(point?.y ?? rect.bottom, innerHeight - menu.offsetHeight - 8))}px`;
  contextMenu = { node: menu, anchor };
  menu.querySelector('button:not(:disabled)')?.focus();
  menu.onkeydown = (event) => {
    const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeActions(true);
    } else if (event.key === 'Tab') closeActions();
  };
}
function bindActions(node, actions) {
  node.addEventListener('contextmenu', (event) => {
    if (event.target.closest('input, textarea')) return;
    event.preventDefault();
    event.stopPropagation();
    openActions(node.querySelector('button') || node, actions(), {
      x: event.clientX,
      y: event.clientY,
    });
  });
  node.addEventListener('keydown', (event) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    event.stopPropagation();
    openActions(document.activeElement, actions());
  });
}
function selectMove(tabId) {
  selection.clear();
  selection.add(tabId);
  selectedTab = tabId;
  selectedGroup = undefined;
  render();
  $('destination').focus();
}
function tabActions(tab, window) {
  const siblings = window.tabIds,
    index = siblings.indexOf(tab.id);
  return [
    ['Select', () => selectMove(tab.id)],
    [
      'Move up',
      () => void moveTab(tab.id, window.id, siblings[index - 1]),
      tab.pinned || index <= 0 || !canEdit(),
    ],
    [
      'Move down',
      () => void moveTab(tab.id, window.id, siblings[index + 2]),
      tab.pinned || index >= siblings.length - 1 || !canEdit(),
    ],
  ];
}
function windowActions(window, head) {
  const key = String(window.id),
    index = windowOrder.indexOf(key);
  const shift = (direction) => {
    [windowOrder[index], windowOrder[index + direction]] = [windowOrder[index + direction], key];
    render();
  };
  return [
    [foldedWindows.has(key) ? 'Expand' : 'Fold', () => toggleFold(window.id)],
    ['Rename', () => renameWindow(head, head.querySelector('.rename-window'), window), busy],
    [
      'Select all',
      () => {
        window.tabIds.forEach((id) => selection.add(id));
        render();
      },
    ],
    ['Move earlier on board', () => shift(-1), index <= 0],
    ['Move later on board', () => shift(1), index >= windowOrder.length - 1],
  ];
}
function endWindowDrag(commit = false) {
  const drag = windowDrag;
  if (!drag) return;
  drag.ghost?.remove();
  drag.card.classList.remove('dragging');
  drag.target?.classList.remove('window-drop-target');
  document.body.classList.remove('is-dragging');
  windowDrag = undefined;
  if (commit && drag.target) {
    const from = windowOrder.indexOf(drag.card.dataset.windowId);
    const to = windowOrder.indexOf(drag.target.dataset.windowId);
    windowOrder.splice(from, 1);
    windowOrder.splice(to, 0, drag.card.dataset.windowId);
    render();
  }
  if (deferredResult) {
    const result = deferredResult;
    deferredResult = undefined;
    receive(result);
  }
}
function windowPointerSource(head, card) {
  head.addEventListener('pointerdown', (event) => {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      event.target.closest('button, input') ||
      busy ||
      staging
    )
      return;
    closeActions();
    windowDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, card };
    head.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  head.addEventListener('pointermove', (event) => {
    const drag = windowDrag;
    if (drag?.id !== event.pointerId) return;
    if (!drag.ghost && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
    if (!drag.ghost) {
      drag.ghost = head.cloneNode(true);
      drag.ghost.className = 'window-head window-ghost';
      drag.ghost.setAttribute('aria-hidden', 'true');
      drag.ghost.style.width = `${card.offsetWidth}px`;
      drag.ghost.style.setProperty('--window-color', card.style.getPropertyValue('--window-color'));
      document.body.append(drag.ghost);
      card.classList.add('dragging');
      document.body.classList.add('is-dragging');
    }
    drag.ghost.style.transform = `translate(${Math.max(8, Math.min(event.clientX - 40, innerWidth - card.offsetWidth - 8))}px, ${Math.max(8, event.clientY - 20)}px)`;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.window');
    drag.target?.classList.remove('window-drop-target');
    drag.target = target !== card ? target : undefined;
    drag.target?.classList.add('window-drop-target');
  });
  head.addEventListener('pointerup', () => endWindowDrag(true));
  head.addEventListener('pointercancel', () => endWindowDrag());
  head.addEventListener('lostpointercapture', () => endWindowDrag());
}
document.addEventListener('pointerdown', (event) => {
  if (contextMenu && !contextMenu.node.contains(event.target)) closeActions();
});
window.addEventListener('blur', () => {
  closeActions();
  endWindowDrag();
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') endWindowDrag();
});

function renderMoveControls(source, windows, editable) {
  const ids = source ? selectedIds(source) : [];
  const pins = source?.tabs.some((t) => selection.has(t.id) && t.pinned);
  $('move-controls').hidden = !ids.length;
  $('moving-title').textContent = ids.length + ' selected';
  $('destination').replaceChildren(
    element('option', '', 'Move to…'),
    ...[...windows, { id: 'new', title: 'New window' }].map((w) => {
      const option = element('option', '', w.title);
      option.value = w.id;
      return option;
    }),
  );
  $('destination').firstChild.value = '';
  $('destination').disabled = !editable || pins;
  $('group-tabs').disabled = !editable || pins;
  $('summarize').disabled = busy || !ready;
  $('pin-reason').hidden = !pins;
  const sourceWindows = new Set(
    source?.tabs.filter((t) => selection.has(t.id)).map((t) => t.windowId),
  );
  const previous = $('group-window').value;
  $('group-window').replaceChildren(
    element('option', '', 'Destination window…'),
    ...[...(source?.windows || []), { id: -1, title: 'New window' }].map((w) => {
      const option = element('option', '', w.title || 'Window ' + w.id);
      option.value = w.id;
      return option;
    }),
  );
  $('group-window').firstChild.value = '';
  $('group-window').hidden = sourceWindows.size <= 1;
  if (sourceWindows.size === 1) $('group-window').value = [...sourceWindows][0];
  else if ([...$('group-window').options].some((o) => o.value === previous))
    $('group-window').value = previous;
  const destinationGroups = $('group-window').value
    ? (source?.groups || []).filter((g) => g.windowId === Number($('group-window').value))
    : [];
  $('existing-group').replaceChildren(
    element('option', '', 'Existing group…'),
    ...destinationGroups.map((g) => {
      const option = element('option', '', g.title || 'Unnamed group');
      option.value = g.id;
      return option;
    }),
  );
  $('existing-group').firstChild.value = '';
  $('existing-group').hidden = !destinationGroups.length;
  $('undo').hidden = !data?.canUndo;
  $('undo').disabled = busy;
  $('active-summary').hidden = !data?.summary;
  if (data?.summary)
    $('active-summary').textContent =
      'Summarizing ' + data.summary.completed + ' of ' + data.summary.total + ' · Open';
}
function renameWindow(head, button, window) {
  const heading = head.querySelector('h2');
  const input = element('input', 'window-label');
  input.value = window.title;
  input.maxLength = 1000;
  input.setAttribute('aria-label', 'Window label');
  heading.replaceWith(input);
  button.textContent = 'Save';
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
  const row = element('div', 'proposal-bar');
  const duplicates = proposal.duplicates ?? [];
  const count = proposal.changedTabIds.filter(
    (id) => !duplicates.some((d) => d.tabId === id),
  ).length;
  const receipt = proposal.receipt;
  const renames = proposal.projected.filter((w) => {
    const index = proposal.before.windows.findIndex((original) => original.id === w.id);
    return (
      index >= 0 && w.title !== (proposal.before.windows[index].title || `Window ${index + 1}`)
    );
  }).length;
  let message = busy
    ? 'Applying…'
    : draftLayout
      ? 'Checking…'
      : count
        ? `${quantity(count, 'tab')} to move${renames ? ` · ${quantity(renames, 'rename')}` : ''}`
        : renames
          ? `${quantity(renames, 'window')} to rename`
          : duplicates.length
            ? 'Remove duplicates'
            : 'Sync window names';
  if (proposal.status === 'applied')
    message =
      count || receipt?.completedClosures
        ? `Applied · ${quantity(count, 'tab')} moved${receipt?.completedClosures ? ` · ${receipt.completedClosures} closed` : ''}`
        : 'Applied · window names updated';
  else if (proposal.status === 'stale') message = 'Tabs changed · arrange again';
  else if (proposal.status === 'failed')
    message = `Incomplete · ${quantity(receipt?.completedMoves ?? 0, 'tab')} moved`;
  else if (!pending) message = proposal.status;
  else if (!valid && !draftLayout) message = 'Preview expired';
  row.append(element('strong', 'proposal-summary', message));
  if (pending && duplicates.length)
    row.append(
      element('span', 'duplicate-count', `${quantity(duplicates.length, 'duplicate')} will close`),
    );
  const detail = element('details');
  detail.open = detailsOpen;
  detail.append(element('summary', '', 'Details'), element('p', '', proposal.summary));
  if (duplicates.length) {
    const list = element('ul');
    for (const duplicate of duplicates) {
      const tab = proposal.before.tabs.find((t) => t.id === duplicate.tabId);
      const keeper = proposal.before.tabs.find((t) => t.id === duplicate.keepTabId);
      list.append(
        element(
          'li',
          '',
          `Close “${tab?.title || duplicate.url}”; keep “${keeper?.title || duplicate.url}” (tab ${duplicate.keepTabId}).`,
        ),
      );
    }
    detail.append(list);
  }
  if (pending) {
    const label = element('label', 'duplicate-choice');
    const checkbox = element('input');
    checkbox.type = 'checkbox';
    checkbox.checked = proposal.deduplicate !== false;
    checkbox.disabled = busy || staging || refreshing || !snapshot || Boolean(draftLayout);
    checkbox.onchange = () => {
      const original = proposal.windows.map((w, index) => ({
        id: w.windowId ?? `new-${index + 1}`,
        title: w.title,
        tabIds: [
          ...proposal.before.tabs
            .filter((t) => t.windowId === w.windowId && fixed(t))
            .sort((a, b) => a.index - b.index)
            .map((t) => t.id),
          ...w.tabIds,
        ],
      }));
      // Fixed-only windows may be implicit in the submitted layout.
      original.push(...proposal.projected.filter((w) => !original.some((x) => x.id === w.id)));
      void stageDraft(proposal.before, original, checkbox.checked);
    };
    label.append(checkbox, document.createTextNode('Remove duplicate tabs'));
    detail.append(label);
  }
  if (receipt) detail.append(element('p', '', receipt.message));
  if (pending) {
    const apply = element('button', 'primary', busy ? 'Applying…' : 'Apply');
    apply.id = 'apply';
    apply.disabled =
      !valid ||
      !approvalToken ||
      busy ||
      staging ||
      Boolean(draftLayout) ||
      refreshing ||
      !snapshot;
    apply.onclick = applyPlan;
    if (!valid && !staging) {
      const renew = element('button', '', 'Retry');
      renew.disabled = busy || refreshing || !snapshot;
      renew.onclick = () => {
        const { source, windows } = layout();
        void stageDraft(source, windows);
      };
      row.append(renew);
    }
    const reset = element('button', '', 'Discard');
    reset.disabled = busy || staging || refreshing || !snapshot;
    reset.onclick = () => {
      draftLayout = undefined;
      void manual('saul_workspace_discard');
    };
    row.append(reset, apply);
  }
  if (proposal.status === 'failed') {
    detail.open = true;
  }
  panel.append(row, detail);
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
  $('counts').textContent = snapshot
    ? `${quantity(snapshot.windows.length, 'window')} · ${quantity(snapshot.tabs.length, 'tab')}`
    : '';
  renderProposal(proposal, snapshot);
  const { source, windows } = layout();
  const editable = canEdit();
  const filter = $('filter').value.toLowerCase();
  const tabMap = new Map(source?.tabs.map((t) => [t.id, t]) ?? []);
  windowOrder = [
    ...windowOrder.filter((id) => windows.some((w) => String(w.id) === id)),
    ...windows.map((w) => String(w.id)).filter((id) => !windowOrder.includes(id)),
  ];
  const cards = [...windows]
    .sort((a, b) => windowOrder.indexOf(String(a.id)) - windowOrder.indexOf(String(b.id)))
    .map((w) => {
      const tabs = w.tabIds
        .map((id) => tabMap.get(id))
        .filter(Boolean)
        .filter((t) => `${t.title} ${t.url}`.toLowerCase().includes(filter));
      if (!tabs.length && filter) return null;
      const signature = JSON.stringify([
        w.title,
        foldedWindows.has(String(w.id)),
        source.windows,
        w.tabIds,
        tabs,
        source.groups,
        tabs.map((t) => proposal?.changedTabIds.includes(t.id)),
        editable,
        tabs.filter((tab) => selection.has(tab.id)).map((tab) => tab.id),
        filter,
      ]);
      const old = oldCards.get(String(w.id));
      if (old?.dataset.signature === signature) return old;
      const card = element('section', 'window');
      card.dataset.signature = signature;
      card.dataset.windowId = w.id;
      card.dataset.dropWindow = w.id;
      const head = element('div', 'window-head');
      const identity = windowIdentity(source, w.id, windows);
      card.style.setProperty('--window-color', identity.color);
      const fold = element('button', 'fold-window', String(identity.index));
      fold.title = foldedWindows.has(String(w.id)) ? 'Expand window' : 'Fold window';
      fold.setAttribute('aria-label', `${fold.title}: ${w.title}`);
      fold.setAttribute('aria-expanded', String(!foldedWindows.has(String(w.id))));
      fold.onclick = () => {
        toggleFold(w.id);
      };
      head.append(
        fold,
        element('h2', '', w.title || `Window ${w.id}`),
        element('span', '', quantity(w.tabIds.length, 'tab')),
      );
      const rename = element('button', 'rename-window', 'Rename');
      rename.disabled = !ready || busy || staging;
      rename.setAttribute('aria-label', `Rename window: ${w.title}`);
      rename.onclick = () => renameWindow(head, rename, w);
      head.append(rename);
      const selectAll = element('input');
      selectAll.type = 'checkbox';
      selectAll.setAttribute('aria-label', 'Select all in ' + w.title);
      selectAll.checked = tabs.length > 0 && tabs.every((t) => selection.has(t.id));
      selectAll.onchange = () => {
        tabs.forEach((t) => (selectAll.checked ? selection.add(t.id) : selection.delete(t.id)));
        selectedGroup = undefined;
        render();
      };
      head.prepend(selectAll);
      windowPointerSource(head, card);
      head.tabIndex = 0;
      head.setAttribute('aria-label', `${w.title}: drag to reorder, or open actions`);
      bindActions(head, () => windowActions(w, head));
      head.onkeydown = (event) => {
        if (event.target === head && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          openActions(head, windowActions(w, head));
        }
      };
      const list = element('ol', 'tabs');
      list.dataset.windowId = w.id;
      list.hidden = foldedWindows.has(String(w.id));
      let previousGroup;
      for (const tab of tabs) {
        const changed =
          ['pending', 'expired'].includes(proposal?.status) &&
          proposal.changedTabIds.includes(tab.id);
        const item = element(
          'li',
          'tab' + (changed ? ' changed' : '') + (selection.has(tab.id) ? ' selected' : ''),
        );
        item.title = `${tab.title || 'Untitled tab'}\n${tab.url}`;
        item.dataset.tabId = tab.id;
        item.draggable = false;
        item.dataset.movable = String(Boolean(editable && !tab.pinned));
        if (!tab.pinned && editable) pointerSource(item, tab.id);
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

        bindActions(item, () => tabActions(tab, w, item));
        const check = element('input');
        check.type = 'checkbox';
        check.checked = selection.has(tab.id);
        check.disabled = busy;
        check.setAttribute('aria-label', 'Select ' + (tab.title || 'Untitled tab'));
        check.dataset.focusKey = 'select-' + tab.id;
        check.onclick = (event) => {
          const previous = tabs.findIndex((t) => t.id === selectedTab),
            index = tabs.indexOf(tab);
          if (event.shiftKey && previous >= 0)
            tabs
              .slice(Math.min(previous, index), Math.max(previous, index) + 1)
              .forEach((t) => selection.add(t.id));
          else if (check.checked) selection.add(tab.id);
          else selection.delete(tab.id);
          selectedTab = tab.id;
          selectedGroup = undefined;
          render();
        };
        check.onkeydown = (event) => {
          if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          const i = w.tabIds.indexOf(tab.id),
            before = w.tabIds[i + (event.key === 'ArrowUp' ? -1 : 2)];
          if (
            (event.key === 'ArrowUp' && i === 0) ||
            (event.key === 'ArrowDown' && i === w.tabIds.length - 1)
          )
            return;
          void moveTab(tab.id, w.id, before);
        };
        item.append(check);
        if (group && previousGroup !== group.id) {
          const groupHead = element('li', 'tab-group-head', group.title || 'Unnamed group');
          groupHead.dataset.groupId = group.id;
          groupHead.tabIndex = 0;
          groupHead.setAttribute('aria-label', 'Tab group: ' + (group.title || 'Unnamed group'));
          if (editable) pointerSource(groupHead, tab.id, group.id);
          groupHead.onclick = () => {
            selection.clear();
            source.tabs.filter((t) => t.groupId === group.id).forEach((t) => selection.add(t.id));
            selectedGroup = group.id;
            selectedTab = tab.id;
            render();
          };
          groupHead.onkeydown = (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              groupHead.click();
              $('destination').focus();
            }
          };
          list.append(groupHead);
        }
        previousGroup = group?.id;
        item.append(text);
        list.append(item);
      }
      const end = element('div', 'window-end', 'Drop at end');
      end.hidden = !editable || foldedWindows.has(String(w.id));
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
            ? 'No Chrome session connected. Open Saul → Settings → Codex connection and enable tab access, then refresh.'
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
      newWindow.append(element('span', 'guidance', 'Drop a tab here'));
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
        // Never animate hit-test geometry: a second drag may begin before this
        // feedback ends, and its insertion target must already be settled.
        [{ opacity: 0.55 }, { opacity: 1 }],
        { duration: 160, easing: 'cubic-bezier(.2,.8,.2,1)' },
      );
    }
  }
  animateNextRender = false;
  if (focusKey)
    document.querySelector(`[data-focus-key="${focusKey}"]`)?.focus({ preventScroll: true });
  if (data?.error || data?.snapshot?.nativeNames?.status === 'unavailable')
    status(data.error || data.snapshot.nativeNames.message, true);
}
async function refresh() {
  if (
    busy ||
    staging ||
    refreshing ||
    !ready ||
    pointerDrag ||
    windowDrag ||
    draggedTab !== undefined
  )
    return;
  refreshing = true;
  $('refresh').disabled = true;
  try {
    await tool('saul_workspace_state', data?.session ? { session: data.session } : {});
    const error =
      data?.error ||
      (data?.snapshot?.nativeNames?.status === 'unavailable'
        ? data.snapshot.nativeNames.message
        : '');
    status(error || '', Boolean(error));
  } catch (error) {
    approvalToken = undefined;
    status(error.message, true);
  } finally {
    refreshing = false;
    if (!pointerDrag && !windowDrag && draggedTab === undefined) render();
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
  status('');
  try {
    await tool('saul_workspace_apply', args);
    status('');
  } catch (error) {
    approvalToken = undefined;
    status(error.message, true);
  } finally {
    busy = false;
    render();
  }
}
$('refresh').onclick = refresh;
function cancelMove() {
  const key = selectedTab;
  selection.clear();
  selectedTab = undefined;
  selectedGroup = undefined;
  $('group-form').hidden = true;
  render();
  document.querySelector('[data-focus-key="select-' + key + '"]')?.focus();
}
$('cancel-move').onclick = cancelMove;
$('destination').onchange = () => {
  if (!$('destination').value) return;
  void moveTab(selectedIds()[0], $('destination').value, undefined, undefined, selectedGroup);
};
$('group-window').onchange = render;
$('group-tabs').onclick = () => {
  $('group-form').hidden = !$('group-form').hidden;
  if (!$('group-form').hidden) $('group-title').focus();
};
$('group-form').onsubmit = (event) => {
  event.preventDefault();
  if (!$('group-title').value.trim()) return $('group-title').focus();
  if (!$('group-window').value) return $('group-window').focus();
  void manual('saul_workspace_edit', {
    revision: data.revision,
    kind: 'group',
    tabIds: selectedIds(),
    windowId: Number($('group-window').value),
    title: $('group-title').value.trim(),
  });
};
$('existing-group').onchange = () => {
  if ($('existing-group').value)
    void manual('saul_workspace_edit', {
      revision: data.revision,
      kind: 'group',
      tabIds: selectedIds(),
      groupId: Number($('existing-group').value),
    });
};
$('summarize').onclick = () => void manual('saul_workspace_summarize', { tabIds: selectedIds() });
$('active-summary').onclick = () =>
  void manual('saul_workspace_summarize', { id: data.summary.id });
$('undo').onclick = () => void manual('saul_workspace_undo');

$('session').onchange = async () => {
  draftLayout = undefined;
  windowOrder = [];
  foldedWindows.clear();
  selectedTab = undefined;
  selection.clear();
  selectedGroup = undefined;
  data = { ...data, session: $('session').value || undefined, snapshot: null, proposal: null };
  approvalToken = undefined;
  await refresh();
};
$('filter').oninput = render;
window.addEventListener('blur', endDrag);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && pointerDrag) {
    endDrag();
    status('Drag cancelled.');
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
    const text = `Use Saul to propose a window/tab reorganization for browser session ${data.session}. My request: ${goal}\nCall saul_workspace_show for fresh inventory, then saul_workspace_propose with its revision. Preserve pinned tabs, existing groups and existing window labels unless a rename helps my request. Deduplicate by default; include duplicate IDs in the full input so the board can review their removal. Show a dry run in the board and wait for me to click Apply. Do not execute individual mutations.`;
    const result = await request('ui/message', { role: 'user', content: [{ type: 'text', text }] });
    if (result?.isError) throw new Error('Codex could not accept the request');
    $('composer').open = false;
    $('composer').querySelector('summary').focus();
    status('Sent · waiting for a plan');
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
    appInfo: { name: 'Saul Tab board', version: '1.1.0' },
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
      !contextMenu &&
      !windowDrag &&
      !document.activeElement?.closest('#session, #proposal, #group-form, select')
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
