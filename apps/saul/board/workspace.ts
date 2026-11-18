import { controlSymbols } from '../browser/control-symbols.ts';
import { createBoardDrag } from './board-drag.ts';
import type { McpUiHostCapabilities } from '@modelcontextprotocol/ext-apps';
import type { TabSnapshot, TabView } from '../shared/protocol/protocol.mts';
import type { ProjectedWindow } from '../shared/protocol/workspace-contract.mts';
import { tabLabel, tabSite } from '../browser/tab-label.ts';
import { createBoardConnection, diagnostics, standalone } from './board-connection.ts';
import {
  createBoardSession,
  boardError as errorMessage,
  fixed,
  type BoardManualCommand,
  type DisplayProposal,
} from './board-session.ts';

type BoardWindow = ProjectedWindow;
type MenuAction = readonly [string, () => void, boolean?];

const tags = {
  counts: 'p',
  refresh: 'button',
  status: 'p',
  'send-status': 'p',
  'session-picker': 'div',
  session: 'select',
  composer: 'details',
  request: 'textarea',
  'attach-context': 'input',
  ask: 'button',
  'inspect-send': 'button',
  'app-info': 'span',
  proposal: 'section',
  filter: 'input',
  'manual-notice': 'span',
  undo: 'button',
  'active-summary': 'button',
  'move-controls': 'section',
  'moving-title': 'strong',
  'group-tabs': 'button',
  destination: 'select',
  summarize: 'button',
  'cancel-move': 'button',
  'pin-reason': 'p',
  'group-form': 'div',
  'group-title': 'input',
  'group-window': 'select',
  'create-group': 'button',
  'existing-group': 'select',
  board: 'div',
  'minimum-mode': 'input',
  'preference-error': 'p',
} as const;
function $<K extends keyof typeof tags>(id: K): HTMLElementTagNameMap[(typeof tags)[K]] {
  const node = document.getElementById(id);
  if (!node || node.tagName.toLowerCase() !== tags[id])
    throw new Error(`Missing board element: ${id}`);
  return node as HTMLElementTagNameMap[(typeof tags)[K]];
}

$('refresh').innerHTML = controlSymbols.refresh.svg;
$('refresh').setAttribute('aria-label', 'Refresh tabs');
$('refresh').title = 'Refresh tabs';

const minimumModeKey = 'saul-board-minimum-mode';
function setMinimumMode(value: boolean) {
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
let capabilities: McpUiHostCapabilities = {};
let poll: number | undefined,
  resizeObserver: ResizeObserver | undefined,
  selectedTab: number | undefined;
const selection = new Set<number>();
let selectedGroup: number | undefined;
const foldedWindows = new Set<string>();
let windowOrder: string[] = [];
let contextMenu: { node: HTMLDivElement; anchor: HTMLElement } | undefined;
let animateNextRender = false;
const board = createBoardSession({
  call: (name, args) => host.callTool(name, args),
  changed: () => {
    const snapshot = board.state.data?.snapshot;
    if (!snapshot?.tabs.some((tab) => tab.id === selectedTab)) selectedTab = undefined;
    for (const id of selection)
      if (!snapshot?.tabs.some((tab) => tab.id === id)) selection.delete(id);
    render();
  },
  status,
  onSessionChange() {
    windowOrder = [];
    foldedWindows.clear();
    selectedTab = undefined;
    selection.clear();
    selectedGroup = undefined;
    $('group-form').hidden = true;
    $('manual-notice').textContent = '';
  },
  onPreview: () => {
    animateNextRender = true;
  },
  dragActive: () => drag.active,
  tabDragActive: () => drag.tabActive,
});
const drag = createBoardDrag({
  layout,
  canEdit,
  canReorder: () => !board.state.busy && !board.state.staging,
  onWindowStart: () => closeActions(),
  onSelect: (tabId) => {
    if (selection.has(tabId)) selection.delete(tabId);
    else selection.add(tabId);
    selectedTab = tabId;
    selectedGroup = undefined;
    render();
  },
  onMove: (...args) => {
    void moveTab(...args);
  },
  onReorder: (fromId, toId) => {
    const from = windowOrder.indexOf(fromId);
    const to = windowOrder.indexOf(toId);
    windowOrder.splice(from, 1);
    windowOrder.splice(to, 0, fromId);
    render();
  },
  onCancelled: () => status('Move cancelled.'),
  onEnd: board.endDrag,
});
const quantity = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
function status(message: string, error = false) {
  $('status').textContent = message;
  $('status').className = error ? 'error' : '';
}
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string | number,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}
function layout(current = false) {
  const { data, draftLayout } = board.state;
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
      tabIds: source!.tabs
        .filter((tab) => tab.windowId === window.id)
        .sort((a, b) => a.index - b.index)
        .map((tab) => tab.id),
    })),
  };
}
function canEdit() {
  const { ready, busy, refreshing, data, draftLayout } = board.state;
  return Boolean(
    ready &&
    !busy &&
    !refreshing &&
    data?.snapshot &&
    !['pending', 'expired'].includes(data?.proposal?.status ?? '') &&
    !draftLayout,
  );
}
function selectedIds(source = board.state.data?.snapshot) {
  if (!source) return [];
  const order = windowOrder.length ? windowOrder : source.windows.map((w) => String(w.id));
  return [...source.tabs]
    .sort(
      (a, b) =>
        order.indexOf(String(a.windowId)) - order.indexOf(String(b.windowId)) || a.index - b.index,
    )
    .filter((t) => selection.has(t.id))
    .map((t) => t.id);
}
async function manual(...args: BoardManualCommand) {
  const accepted = await board.manual(...args);
  if (accepted) {
    $('manual-notice').textContent = board.state.data?.notice || '';
    $('group-form').hidden = true;
  }
}
async function moveTab(
  tabId: number,
  destination: string | number,
  beforeId?: number,
  groupId?: number,
  sourceGroupId?: number,
) {
  const { data } = board.state;
  if (!canEdit() || !data?.snapshot) return;
  const tab = data.snapshot.tabs.find((t) => t.id === tabId);
  if (!tab || tab.pinned) return;
  const ids =
    sourceGroupId !== undefined
      ? data.snapshot.tabs.filter((t) => t.groupId === sourceGroupId).map((t) => t.id)
      : selection.has(tabId)
        ? selectedIds()
        : [tabId];
  if (
    (beforeId !== undefined && ids.includes(beforeId)) ||
    (sourceGroupId !== undefined && groupId === sourceGroupId)
  )
    return;
  if (sourceGroupId !== undefined && groupId !== undefined)
    beforeId = data.snapshot.tabs
      .filter((t) => t.groupId === groupId)
      .sort((a, b) => a.index - b.index)[0]?.id;
  await manual('saul_workspace_edit', {
    revision: data?.revision,
    kind: sourceGroupId !== undefined ? 'moveGroup' : 'move',
    ...(sourceGroupId !== undefined
      ? { groupId: sourceGroupId }
      : { tabIds: ids, ...(groupId === undefined ? {} : { groupId }) }),
    windowId: destination === 'new' ? -1 : Number(destination),
    ...(beforeId === undefined ? {} : { beforeTabId: beforeId }),
  });
}
function windowIdentity(source: TabSnapshot, id: number | string, windows: BoardWindow[]) {
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
function toggleFold(id: string | number) {
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
function openActions(anchor: HTMLElement, actions: MenuAction[], point?: { x: number; y: number }) {
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
  menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  menu.onkeydown = (event) => {
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = buttons.findIndex((button) => button === document.activeElement);
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
function bindActions(node: HTMLElement, actions: () => MenuAction[]) {
  node.addEventListener('contextmenu', (event) => {
    if (event.target instanceof Element && event.target.closest('input, textarea')) return;
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
    openActions(
      document.activeElement instanceof HTMLElement ? document.activeElement : node,
      actions(),
    );
  });
}
function selectMove(tabId: number) {
  selection.clear();
  selection.add(tabId);
  selectedTab = tabId;
  selectedGroup = undefined;
  render();
  $('destination').focus();
}
function tabActions(tab: TabView, window: BoardWindow): MenuAction[] {
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
function windowActions(window: BoardWindow, head: HTMLElement): MenuAction[] {
  const { busy } = board.state;
  const key = String(window.id),
    index = windowOrder.indexOf(key);
  const shift = (direction: number) => {
    [windowOrder[index], windowOrder[index + direction]] = [windowOrder[index + direction], key];
    render();
  };
  return [
    [foldedWindows.has(key) ? 'Expand' : 'Fold', () => toggleFold(window.id)],
    [
      'Rename',
      () => renameWindow(head, head.querySelector<HTMLButtonElement>('.rename-window')!, window),
      busy,
    ],
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
document.addEventListener('pointerdown', (event) => {
  if (contextMenu && event.target instanceof Node && !contextMenu.node.contains(event.target))
    closeActions();
});
window.addEventListener('blur', () => {
  closeActions();
  drag.cancelWindow();
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') drag.cancelWindow();
});

function renderMoveControls(
  source: TabSnapshot | null | undefined,
  windows: BoardWindow[],
  editable: boolean,
) {
  const ids = source ? selectedIds(source) : [];
  const pins = source?.tabs.some((t) => selection.has(t.id) && t.pinned);
  $('move-controls').hidden = !ids.length;
  $('moving-title').textContent = ids.length + ' selected';
  $('destination').replaceChildren(
    element('option', '', 'Move to…'),
    ...[...windows, { id: 'new', title: 'New window' }].map((w) => {
      const option = element('option', '', w.title);
      option.value = String(w.id);
      return option;
    }),
  );
  $('destination').options[0].value = '';
  $('destination').disabled = !editable || Boolean(pins);
  $('group-tabs').disabled = !editable || Boolean(pins);
  const { busy, ready, data } = board.state;
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
      option.value = String(w.id);
      return option;
    }),
  );
  $('group-window').options[0].value = '';
  $('group-window').hidden = sourceWindows.size <= 1;
  if (sourceWindows.size === 1) $('group-window').value = String([...sourceWindows][0]);
  else if ([...$('group-window').options].some((o) => o.value === previous))
    $('group-window').value = previous;
  const destinationGroups = $('group-window').value
    ? (source?.groups || []).filter((g) => g.windowId === Number($('group-window').value))
    : [];
  $('existing-group').replaceChildren(
    element('option', '', 'Existing group…'),
    ...destinationGroups.map((g) => {
      const option = element('option', '', g.title || 'Unnamed group');
      option.value = String(g.id);
      return option;
    }),
  );
  $('existing-group').options[0].value = '';
  $('existing-group').hidden = !destinationGroups.length;
  $('undo').hidden = !data?.canUndo;
  $('undo').disabled = busy || !ready;
  $('active-summary').hidden = !data?.summary;
  $('active-summary').disabled = busy || !ready;
  if (data?.summary)
    $('active-summary').textContent =
      'Summarizing ' + data.summary.completed + ' of ' + data.summary.total + ' · Open';
}
function renameWindow(head: HTMLElement, button: HTMLButtonElement, window: BoardWindow) {
  const heading = head.querySelector('h2');
  if (!heading) return;
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
    void board.stageDraft(
      current.source,
      current.windows.map((item) => ({
        ...item,
        title: item.id === window.id ? title : item.title,
      })),
    );
  };
  button.onclick = save;
  input.onkeydown = (event) => {
    // Let the IME confirm or dismiss its candidate without ending the rename.
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Enter') save();
    else cancel();
  };
  input.focus();
  input.select();
}

function renderProposal(
  proposal: DisplayProposal | null | undefined,
  snapshot: TabSnapshot | null | undefined,
) {
  const panel = $('proposal');
  const { data, draftLayout, busy, ready, staging, refreshing, approvalToken } = board.state;
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
          `Close “${tabLabel(tab?.title || '', duplicate.url)}”; keep “${tabLabel(keeper?.title || '', duplicate.url)}” (tab ${duplicate.keepTabId}).`,
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
    checkbox.disabled =
      !ready || busy || staging || refreshing || !snapshot || Boolean(draftLayout);
    checkbox.onchange = () => {
      if (!proposal.windows) return;
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
      void board.stageDraft(proposal.before, original, checkbox.checked);
    };
    label.append(checkbox, document.createTextNode('Remove duplicate tabs'));
    detail.append(label);
  }
  if (receipt) detail.append(element('p', '', receipt.message));
  if (pending) {
    const apply = element('button', 'primary', busy ? 'Applying…' : 'Apply');
    apply.id = 'apply';
    apply.disabled =
      !ready ||
      !valid ||
      !approvalToken ||
      !data?.session ||
      busy ||
      staging ||
      Boolean(draftLayout) ||
      refreshing ||
      !snapshot;
    apply.onclick = board.apply;
    if (!valid && !staging) {
      const renew = element('button', '', 'Retry');
      renew.disabled = !ready || busy || refreshing || !snapshot;
      renew.onclick = () => {
        const { source, windows } = layout();
        void board.stageDraft(source, windows);
      };
      row.append(renew);
    }
    const reset = element('button', '', 'Discard');
    reset.disabled = !ready || busy || staging || refreshing || !snapshot;
    reset.onclick = () => void manual('saul_workspace_discard');
    row.append(reset, apply);
  }
  if (proposal.status === 'failed') {
    detail.open = true;
  }
  panel.append(row, detail);
}

function render() {
  const { data, busy, ready, staging, refreshing } = board.state;
  const focusKey =
    document.activeElement instanceof HTMLElement
      ? document.activeElement.dataset.focusKey
      : undefined;
  const oldBoardTop = $('board').getBoundingClientRect().top;
  const oldRects = new Map(
    [...document.querySelectorAll<HTMLElement>('.tab')].map((node) => [
      node.dataset.tabId,
      node.getBoundingClientRect(),
    ]),
  );
  const oldCards = new Map(
    [...document.querySelectorAll<HTMLElement>('.window')].map((node) => [
      node.dataset.windowId,
      node,
    ]),
  );
  const scroll = new Map(
    [...document.querySelectorAll<HTMLOListElement>('.tabs')].map((list) => [
      list.dataset.windowId,
      list.scrollTop,
    ]),
  );
  const snapshot = data?.snapshot;
  const proposal = board.displayProposal();
  $('refresh').disabled = !ready || busy || staging || refreshing;
  $('ask').disabled =
    busy || staging || refreshing || (standalone ? false : !ready || !capabilities.message);
  const messageLabel = standalone ? 'Copy message' : 'Send';
  $('ask').innerHTML = controlSymbols[standalone ? 'copy' : 'send'].svg;
  $('ask').setAttribute('aria-label', messageLabel);
  $('ask').title = messageLabel;
  $('session').disabled = !ready || busy || staging || !data?.sessions?.length;
  $('session').replaceChildren(
    ...(data?.sessions ?? []).map((s) => {
      const option = element(
        'option',
        '',
        `${s.session.slice(0, 8)} · ${s.extensionId.slice(0, 8)}`,
      );
      option.value = s.session;
      option.selected = s.session === data?.session;
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
      if (!source) return null;
      const tabs = w.tabIds
        .map((id) => tabMap.get(id))
        .filter((value) => value != null)
        .map((t) => ({ ...t, label: tabLabel(t.title, t.url) }))
        .filter((t) => `${t.label} ${t.title} ${t.url}`.toLowerCase().includes(filter));
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
      card.dataset.windowId = String(w.id);
      card.dataset.dropWindow = String(w.id);
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
      drag.attachWindow(head, card);
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
      list.dataset.windowId = String(w.id);
      list.hidden = foldedWindows.has(String(w.id));
      let previousGroup;
      for (const tab of tabs) {
        const changed =
          ['pending', 'expired'].includes(proposal?.status ?? '') &&
          proposal?.changedTabIds.includes(tab.id);
        const item = element(
          'li',
          'tab' + (changed ? ' changed' : '') + (selection.has(tab.id) ? ' selected' : ''),
        );
        item.title = `${tab.title || 'Untitled tab'}\n${tab.url}`;
        item.dataset.tabId = String(tab.id);
        item.draggable = false;
        item.dataset.movable = String(Boolean(editable && !tab.pinned));
        if (!tab.pinned && editable) drag.attachTab(item, tab.id);
        const name = tabSite(tab.url);
        const text = element('div');
        const title = element('div', 'tab-title', tab.label);
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
        if (tab.pinned) detail?.append(element('span', 'tag', 'Pinned'));

        bindActions(item, () => tabActions(tab, w));
        const check = element('input');
        check.type = 'checkbox';
        check.checked = selection.has(tab.id);
        check.disabled = busy;
        check.setAttribute('aria-label', 'Select ' + tab.label);
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
          groupHead.dataset.groupId = String(group.id);
          groupHead.tabIndex = 0;
          groupHead.setAttribute('aria-label', 'Tab group: ' + (group.title || 'Unnamed group'));
          if (editable) drag.attachTab(groupHead, tab.id, group.id);
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
    .filter((value) => value != null);
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
    let newWindow = document.getElementById('new-window');
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
    obsolete.parentNode?.removeChild(obsolete);
  }
  renderMoveControls(source, windows, editable);
  for (const list of document.querySelectorAll<HTMLOListElement>('.tabs'))
    list.scrollTop = scroll.get(list.dataset.windowId) ?? 0;
  // Anchor the board when the review bar appears; retain each window's scroll position.
  if (oldCards.size && !drag.tabActive)
    window.scrollBy(0, $('board').getBoundingClientRect().top - oldBoardTop);
  if (animateNextRender && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (const node of document.querySelectorAll<HTMLElement>('.tab')) {
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
    document
      .querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`)
      ?.focus({ preventScroll: true });
  if (data?.error || data?.snapshot?.nativeNames?.status === 'unavailable')
    status(data.error || data.snapshot?.nativeNames?.message || '', true);
}
$('refresh').onclick = board.refresh;
function cancelMove() {
  const key = selectedTab;
  selection.clear();
  selectedTab = undefined;
  selectedGroup = undefined;
  $('group-form').hidden = true;
  render();
  document.querySelector<HTMLElement>('[data-focus-key="select-' + key + '"]')?.focus();
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
$('create-group').onclick = (event) => {
  event.preventDefault();
  if (!$('group-title').value.trim()) return $('group-title').focus();
  if (!$('group-window').value) return $('group-window').focus();
  void manual('saul_workspace_edit', {
    revision: board.state.data?.revision,
    kind: 'group',
    tabIds: selectedIds(),
    windowId: Number($('group-window').value),
    title: $('group-title').value.trim(),
  });
};
// Sandboxed hosts can forbid HTML form submission, including submit events.
$('group-title').onkeydown = (event) => {
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    $('create-group').click();
  }
};
$('existing-group').onchange = () => {
  if ($('existing-group').value)
    void manual('saul_workspace_edit', {
      revision: board.state.data?.revision,
      kind: 'group',
      tabIds: selectedIds(),
      groupId: Number($('existing-group').value),
    });
};
$('summarize').onclick = () => void manual('saul_workspace_summarize', { tabIds: selectedIds() });
$('active-summary').onclick = () => {
  const summary = board.state.data?.summary;
  if (summary) void manual('saul_workspace_summarize', { id: summary.id });
};
$('undo').onclick = () => void manual('saul_workspace_undo');

$('session').onchange = () => void board.selectSession($('session').value || undefined);
$('filter').oninput = render;
window.addEventListener('blur', drag.cancelTab);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && drag.tabActive) {
    drag.cancelTab();
    status('Drag cancelled.');
  } else if (event.key === 'Escape' && selectedTab !== undefined) cancelMove();
});
function sendStatus(message: string, error = false) {
  $('send-status').hidden = false;
  $('send-status').textContent = message;
  $('send-status').className = error ? 'error' : '';
}
let lastSend: string | undefined;
$('app-info').append(diagnostics.button());
$('inspect-send').onclick = () => diagnostics.show('Interactions', lastSend);
if (standalone) {
  $('composer').querySelector('summary')!.textContent = 'Message draft';
  $('status').textContent = 'Connecting to local board…';
}
$('ask').onclick = async () => {
  const { busy, data } = board.state;
  if (busy || board.state.refreshing || board.state.staging) return;
  const goal = $('request').value;
  if (!goal.trim()) {
    $('request').focus();
    return;
  }
  const attachContext = $('attach-context').checked;
  if (attachContext && !data?.session) {
    sendStatus('Select a connected browser session before attaching context.', true);
    return;
  }
  board.setSending(true);
  try {
    const ids = selectedIds();
    const text = attachContext
      ? goal +
        '\n\nSelected browser context (data):\n' +
        JSON.stringify({
          session: data?.session,
          revision: data?.revision,
          selectedTabIds: ids,
        })
      : goal;
    const sending = host.sendMessage(text);
    lastSend = diagnostics.lastInteraction;
    $('inspect-send').disabled = false;
    await sending;
    if (
      !standalone &&
      $('request').value === goal &&
      $('attach-context').checked === attachContext
    ) {
      $('request').value = '';
      $('attach-context').checked = false;
      $('composer').open = false;
      $('composer').querySelector('summary')?.focus();
    }
    sendStatus(
      standalone
        ? 'Copied message. Paste it into your chosen conversation.'
        : 'Accepted by host. Check this chat for arrival and a response.',
    );
  } catch (error) {
    sendStatus(errorMessage(error), true);
  } finally {
    board.setSending(false);
  }
};
const host = createBoardConnection({
  onResult: board.hostResult,
  onContext: (context) => {
    if (context.theme) document.documentElement.dataset.theme = context.theme;
  },
  onError: (error) => status(errorMessage(error), true),
  onClose: () => {
    board.setReady(false);
    clearInterval(poll);
    resizeObserver?.disconnect();
    drag.cancelTab();
    render();
    status(
      'Host connection closed. Reopen the board to inspect current state; do not repeat an uncertain action.',
      true,
    );
  },
});
try {
  capabilities = await host.connect();
  board.setReady(Boolean(capabilities.serverTools));
  if (board.state.ready) await board.refresh();
  if (!capabilities.serverTools)
    status('This host cannot call Saul tools. Open the board in a compatible host.', true);
  else if (!standalone && !capabilities.message)
    status('This host cannot send messages. Ask Codex in chat to propose a Saul layout.');
  if (board.state.ready)
    poll = window.setInterval(() => {
      if (
        !document.hidden &&
        !board.state.draftLayout &&
        !contextMenu &&
        !drag.windowActive &&
        !document.activeElement?.closest('#session, #proposal, #group-form, select')
      )
        void board.refresh();
    }, 10000);
  resizeObserver = new ResizeObserver(() =>
    host.resize(Math.min(document.documentElement.scrollHeight, 1200)),
  );
  resizeObserver.observe(document.body);
} catch (error) {
  status(
    `${standalone ? 'Local board unavailable. Keep this draft and inspect the connection.' : 'Open this view through the Saul MCP tool in Codex.'} ${errorMessage(error)}`,
    true,
  );
}
