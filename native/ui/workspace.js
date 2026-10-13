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
let poll, draggedTab, selectedTab;
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
  const next = result.structuredContent;
  if (next.proposal?.id !== data?.proposal?.id && next.proposal?.status === 'pending')
    mode = 'proposed';
  endDrag();
  data = next;
  if (!next.snapshot?.tabs.some((tab) => tab.id === selectedTab)) selectedTab = undefined;
  approvalToken = result._meta?.approvalToken;
  render();
}
async function tool(name, args) {
  const result = await request('tools/call', { name, arguments: args });
  receive(result);
  return result;
}
function layout() {
  const proposal = data?.proposal;
  if (mode === 'proposed' && proposal)
    return { source: proposal.before, windows: proposal.projected };
  const source = data?.snapshot;
  return {
    source,
    windows: (source?.windows ?? []).map((window, index) => ({
      id: window.id,
      title: `Window ${index + 1}`,
      tabIds: source.tabs
        .filter((tab) => tab.windowId === window.id)
        .sort((a, b) => a.index - b.index)
        .map((tab) => tab.id),
    })),
  };
}
function canEdit() {
  return (
    ready &&
    !busy &&
    !refreshing &&
    data?.snapshot &&
    (mode === 'current' ||
      (data.proposal?.status === 'pending' && data.proposal.expiresAt > Date.now()))
  );
}
function endDrag() {
  draggedTab = undefined;
  document.querySelectorAll('.dragging, .drop-before, .drop-target').forEach((node) => {
    node.classList.remove('dragging', 'drop-before', 'drop-target');
  });
}
function dropTarget(node, destination, beforeId) {
  node.addEventListener('dragover', (event) => {
    if (draggedTab === undefined || !canEdit()) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.drop-before, .drop-target').forEach((target) => {
      target.classList.remove('drop-before', 'drop-target');
    });
    node.classList.add(beforeId === undefined ? 'drop-target' : 'drop-before');
  });
  node.addEventListener('dragleave', () => node.classList.remove('drop-before', 'drop-target'));
  node.addEventListener('drop', (event) => {
    if (draggedTab === undefined || !canEdit()) return;
    event.preventDefault();
    event.stopPropagation();
    const tabId = draggedTab;
    endDrag();
    void moveTab(tabId, destination, beforeId);
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
  const args = {
    session: data.session,
    revision: data.revision,
    summary: 'Your manual layout. Review the highlighted changes before applying.',
    windows: draft
      .map((window) => ({
        ...(typeof window.id === 'number' ? { windowId: window.id } : {}),
        title: window.title,
        tabIds: window.tabIds.filter((id) => !fixed(source.tabs.find((t) => t.id === id))),
      }))
      .filter((window) => window.tabIds.length),
  };
  busy = true;
  approvalToken = undefined;
  render();
  status('Preparing your layout preview…');
  try {
    await tool('saul_workspace_propose', args);
    mode = data.proposal ? 'proposed' : 'current';
    status(
      data.proposal
        ? 'Preview updated. Continue arranging tabs, or apply when ready.'
        : 'Layout matches Chrome. No changes to apply.',
    );
  } catch (error) {
    status(error.message, true);
  } finally {
    busy = false;
    render();
  }
}
function render() {
  const focusKey = document.activeElement?.dataset.focusKey;
  const scroll = new Map(
    [...document.querySelectorAll('.tabs')].map((list) => [list.dataset.windowId, list.scrollTop]),
  );
  const snapshot = data?.snapshot;
  const proposal = data?.proposal;
  const valid = proposal?.status === 'pending' && proposal.expiresAt > Date.now();
  $('refresh').disabled = !ready || busy || refreshing;
  $('ask').disabled = !ready || busy || refreshing || !snapshot || !capabilities.message;
  $('session').disabled = busy || refreshing || !data?.sessions?.length;
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
  $('counts').textContent = snapshot
    ? `${quantity(snapshot.windows.length, 'window')} · ${quantity(snapshot.tabs.length, 'tab')}`
    : '';
  $('current').disabled = busy || refreshing;
  $('proposed').disabled = !proposal || busy || refreshing;
  if (!proposal) mode = 'current';
  $('current').setAttribute('aria-pressed', String(mode === 'current'));
  $('proposed').setAttribute('aria-pressed', String(mode === 'proposed'));
  $('proposal').hidden = !proposal;
  $('proposal').replaceChildren();
  if (proposal) {
    const heading = element(
      'h2',
      '',
      proposal.status === 'pending' ? 'Ready for your review' : `Proposal ${proposal.status}`,
    );
    const summary = element('p', '', proposal.summary);
    const meta = element(
      'p',
      'muted',
      `${quantity(proposal.changedTabIds.length, 'tab')} affected · ${quantity(proposal.projected.length, 'resulting window')}`,
    );
    const row = element('div', 'row');
    row.append(
      element(
        'span',
        'muted',
        proposal.receipt?.message ||
          (valid
            ? 'Dry run only. Chrome has not changed.'
            : 'This plan is no longer applicable. Switch to Current to arrange tabs again, or ask Codex for a fresh plan.'),
      ),
    );
    const apply = element('button', 'primary', 'Apply changes to Chrome');
    apply.id = 'apply';
    apply.disabled = !valid || !approvalToken || busy || refreshing || !snapshot;
    apply.onclick = applyPlan;
    row.append(apply);
    $('proposal').append(heading, summary, meta, row);
  }
  const { source, windows } = layout();
  const editable = canEdit();
  const filter = $('filter').value.toLowerCase();
  const cards = windows
    .map((w) => {
      const tabs = w.tabIds
        .map((id) => source.tabs.find((t) => t.id === id))
        .filter(Boolean)
        .filter((t) => `${t.title} ${t.url}`.toLowerCase().includes(filter));
      if (!tabs.length && filter) return null;
      const card = element('section', 'window');
      card.dataset.windowId = w.id;
      dropTarget(card, w.id);
      const head = element('div', 'window-head');
      head.append(
        element('h2', '', w.title || `Window ${w.id}`),
        element('span', '', quantity(w.tabIds.length, 'tab')),
      );
      const list = element('ol', 'tabs');
      list.dataset.windowId = w.id;
      for (const tab of tabs) {
        const changed = mode === 'proposed' && proposal.changedTabIds.includes(tab.id);
        const item = element('li', `tab${changed ? ' changed' : ''}`);
        item.title = tab.url;
        item.dataset.tabId = tab.id;
        item.draggable = Boolean(editable && !fixed(tab));
        if (!fixed(tab)) {
          dropTarget(item, w.id, tab.id);
          item.addEventListener('dragstart', (event) => {
            if (!canEdit()) {
              event.preventDefault();
              return;
            }
            draggedTab = tab.id;
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', String(tab.id));
            item.classList.add('dragging');
            status('Drop before a tab, at the end of a window, or on New window.');
          });
          item.addEventListener('dragend', endDrag);
        }
        const name = domain(tab.url);
        item.append(element('span', 'domain-icon', name.slice(0, 1).toUpperCase()));
        const text = element('div');
        const title = element('div', 'tab-title', tab.title || 'Untitled tab');
        const group = source.groups.find((g) => g.id === tab.groupId);
        if (tab.pinned) title.append(element('span', 'tag', 'Pinned'));
        if (group) title.append(element('span', 'tag', group.title || 'Group'));
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
        item.append(text);
        if (!fixed(tab)) {
          const move = element('button', 'move-handle', '↕');
          move.setAttribute('aria-label', `Move tab: ${tab.title || 'Untitled tab'}`);
          move.setAttribute('aria-pressed', String(selectedTab === tab.id));
          move.dataset.focusKey = `move-${tab.id}`;
          move.disabled = !editable;
          move.onclick = () => {
            selectedTab = selectedTab === tab.id ? undefined : tab.id;
            render();
            if (selectedTab !== undefined) $('destination').focus();
          };
          item.append(move);
        }
        list.append(item);
      }
      const end = element('div', 'window-end', 'Drop here to move to the end');
      end.hidden = !editable;
      card.append(head, list, end);
      return card;
    })
    .filter(Boolean);
  $('board').replaceChildren(
    ...(cards.length
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
        ]),
  );
  if (editable) {
    const newWindow = element('div', 'new-window', '+ New window');
    newWindow.id = 'new-window';
    newWindow.append(element('span', '', 'Drop a tab here to preview a new window'));
    dropTarget(newWindow, 'new');
    $('board').append(newWindow);
  }
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
  for (const list of document.querySelectorAll('.tabs'))
    list.scrollTop = scroll.get(list.dataset.windowId) ?? 0;
  if (focusKey)
    document.querySelector(`[data-focus-key="${focusKey}"]`)?.focus({ preventScroll: true });
  if (data?.error) status(data.error, true);
}
async function refresh() {
  if (busy || refreshing || !ready || draggedTab !== undefined) return;
  refreshing = true;
  render();
  try {
    await tool('saul_workspace_state', data?.session ? { session: data.session } : {});
    status(data?.error || 'Connected · Updated just now', Boolean(data?.error));
  } catch (error) {
    approvalToken = undefined;
    render();
    status(error.message, true);
  } finally {
    refreshing = false;
    render();
  }
}
async function applyPlan() {
  if (busy || refreshing || !approvalToken || data?.proposal?.status !== 'pending') return;
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
$('cancel-move').onclick = () => {
  const key = selectedTab;
  selectedTab = undefined;
  render();
  document.querySelector(`[data-focus-key="move-${key}"]`)?.focus();
};
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
    status('Request sent to Codex. The proposed layout will appear here for review.');
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
    for (const item of pending.values()) clearTimeout(item.timer);
    pending.clear();
    post({ id: message.id, result: {} });
  }
});
try {
  const init = await request('ui/initialize', {
    appInfo: { name: 'Saul workspace', version: '1.0.0' },
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
      selectedTab === undefined &&
      !document.activeElement?.closest('#board, #session')
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
