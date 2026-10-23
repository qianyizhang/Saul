import { useCallback, useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { ActiveSummary, openSummary } from './Summaries';
import { sendWorkspaceMessage } from '../storage/client';
import { tabLayoutRevision } from '../../native/tab-layout.mts';
import type { TabEdit, TabSnapshot, TabView } from '../../native/protocol.mts';

const empty: TabSnapshot = { windows: [], tabs: [], groups: [] };
const hostname = (url: string) => {
  try {
    const u = new URL(url);
    if (u.protocol === 'chrome-extension:') return 'Extension';
    if (u.protocol === 'chrome:') return 'Chrome';
    if (u.protocol === 'about:') return 'Browser page';
    return u.hostname || 'Local file';
  } catch {
    return 'Local tab';
  }
};
type Drag = { ids: number[]; groupId?: number; expected: string };
export function Tabs() {
  const [snapshot, setSnapshot] = useState(empty);
  const [windowId, setWindowId] = useState<number>();
  const [selected, setSelected] = useState<number[]>([]);
  const [filter, setFilter] = useState('');
  const [grouping, setGrouping] = useState(false);
  const [title, setTitle] = useState('');
  const [folded, setFolded] = useState<number[]>([]);
  const [undo, setUndo] = useState<string>();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dropTarget, setDropTarget] = useState<string>();
  const drag = useRef<Drag | undefined>(undefined);
  const anchor = useRef<number | undefined>(undefined);
  const refresh = useCallback(async () => {
    if (busyRef.current || drag.current) return;
    const [result, current] = await Promise.all([
      sendWorkspaceMessage({ action: 'list' }),
      chrome.windows.getCurrent(),
    ]);
    setSnapshot(result.snapshot);
    setWindowId(current.id);
    setSelected((ids) =>
      ids.filter((id) =>
        result.snapshot.tabs.some((t) => t.id === id && t.windowId === current.id),
      ),
    );
  }, []);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (disposed) return;
        if (busyRef.current || drag.current) {
          update();
          return;
        }
        void refresh().catch((e: Error) => setError(e.message));
      }, 150);
    };
    void refresh().catch((e: Error) => setError(e.message));
    const events = [
      chrome.tabs.onCreated,
      chrome.tabs.onRemoved,
      chrome.tabs.onMoved,
      chrome.tabs.onAttached,
      chrome.tabs.onDetached,
      chrome.tabs.onUpdated,
      chrome.tabGroups.onCreated,
      chrome.tabGroups.onRemoved,
      chrome.tabGroups.onUpdated,
      chrome.tabGroups.onMoved,
      chrome.windows.onCreated,
      chrome.windows.onRemoved,
    ];
    for (const event of events) event.addListener(update);
    chrome.storage.onChanged.addListener(update);
    return () => {
      disposed = true;
      clearTimeout(timer);
      for (const event of events) event.removeListener(update);
      chrome.storage.onChanged.removeListener(update);
    };
  }, [refresh]);
  const tabs = snapshot.tabs
    .filter((t) => t.windowId === windowId)
    .sort((a, b) => a.index - b.index);
  const visible = tabs.filter((t) =>
    (t.title + ' ' + t.url).toLowerCase().includes(filter.toLowerCase()),
  );
  const chosen = tabs.filter((t) => selected.includes(t.id));
  const hasPins = chosen.some((t) => t.pinned);
  const groups = snapshot.groups.filter((g) => g.windowId === windowId);
  async function edit(value: Omit<TabEdit, 'expected'>, expected = tabLayoutRevision(snapshot)) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    setUndo(undefined);
    try {
      const result = await sendWorkspaceMessage({
        action: 'command',
        method: 'saul_tabs_edit',
        args: { ...value, expected },
      });
      setSnapshot(result.snapshot);
      setUndo(result.undoToken);
      setNotice(result.message);
      setGrouping(false);
      setSelected((ids) =>
        ids.filter((id) =>
          result.snapshot.tabs.some((t) => t.id === id && t.windowId === windowId),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
      await refresh().catch((e: Error) => setError(e.message));
    }
  }
  async function restore() {
    if (!undo || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await sendWorkspaceMessage({
        action: 'command',
        method: 'saul_tabs_undo',
        args: { token: undo },
      });
      setSnapshot(result.snapshot);
      setNotice(result.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUndo(undefined);
      busyRef.current = false;
      setBusy(false);
      await refresh().catch((e: Error) => setError(e.message));
    }
  }
  function toggle(tab: TabView, shift: boolean) {
    const a = visible.findIndex((t) => t.id === anchor.current),
      b = visible.findIndex((t) => t.id === tab.id);
    if (shift && a >= 0)
      setSelected((ids) => [
        ...new Set([...ids, ...visible.slice(Math.min(a, b), Math.max(a, b) + 1).map((t) => t.id)]),
      ]);
    else
      setSelected((ids) =>
        ids.includes(tab.id) ? ids.filter((id) => id !== tab.id) : [...ids, tab.id],
      );
    anchor.current = tab.id;
  }
  function startDrag(event: React.DragEvent, tab?: TabView, groupId?: number) {
    const ids =
      groupId !== undefined
        ? tabs.filter((t) => t.groupId === groupId).map((t) => t.id)
        : tab && selected.includes(tab.id)
          ? chosen.map((t) => t.id)
          : tab
            ? [tab.id]
            : [];
    if (busy || tabs.some((t) => ids.includes(t.id) && t.pinned)) {
      event.preventDefault();
      return;
    }
    drag.current = { ids, groupId, expected: tabLayoutRevision(snapshot) };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', ids.join(','));
  }
  function drop(event: React.DragEvent, before?: TabView, groupId?: number) {
    event.preventDefault();
    event.stopPropagation();
    const moving = drag.current;
    drag.current = undefined;
    setDropTarget(undefined);
    if (
      !moving ||
      windowId === undefined ||
      (before && moving.ids.includes(before.id)) ||
      (moving.groupId !== undefined && moving.groupId === groupId)
    )
      return;
    let beforeTabId = before?.id;
    if (moving.groupId !== undefined && groupId !== undefined)
      beforeTabId = tabs.find((t) => t.groupId === groupId)?.id;
    void edit(
      {
        kind: moving.groupId !== undefined ? 'moveGroup' : 'move',
        ...(moving.groupId !== undefined
          ? { groupId: moving.groupId }
          : { tabIds: moving.ids, ...(groupId === undefined ? {} : { groupId }) }),
        windowId,
        ...(beforeTabId === undefined ? {} : { beforeTabId }),
      },
      moving.expected,
    );
  }
  function keyboardMove(event: React.KeyboardEvent, tab: TabView, wholeGroup = false) {
    if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key) || busy) return;
    event.preventDefault();
    const moving = wholeGroup ? tabs.filter((t) => t.groupId === tab.groupId) : [tab];
    const first = tabs.indexOf(moving[0]!),
      last = tabs.indexOf(moving.at(-1)!);
    const next = event.key === 'ArrowUp' ? tabs[first - 1] : tabs[last + 1];
    if (!next || next.pinned) return;
    const before = event.key === 'ArrowUp' ? next : tabs[tabs.indexOf(next) + 1];
    void edit({
      kind: wholeGroup ? 'moveGroup' : 'move',
      windowId,
      ...(wholeGroup
        ? { groupId: tab.groupId }
        : {
            tabIds: [tab.id],
            ...(tab.groupId >= 0 && next.groupId === tab.groupId ? { groupId: tab.groupId } : {}),
          }),
      ...(before ? { beforeTabId: before.id } : {}),
    });
  }
  return (
    <section className="stack window-view" aria-label="Window">
      <div className="row between">
        <h2 className="view-title">
          {snapshot.windows.find((w) => w.id === windowId)?.title || 'This window'}{' '}
          <span className="small muted">{tabs.length} tabs</span>
        </h2>
        <button
          className="btn quiet"
          disabled={busy}
          onClick={() => void refresh().catch((e: Error) => setError(e.message))}
        >
          Refresh
        </button>
      </div>
      <ActiveSummary />
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {(notice || undo) && (
        <div className="row small" role="status">
          <span>{notice}</span>
          {undo && (
            <button className="btn quiet" disabled={busy} onClick={() => void restore()}>
              Undo
            </button>
          )}
        </div>
      )}
      <div className="row">
        <label className="select-all">
          <input
            type="checkbox"
            aria-label="Select all tabs"
            disabled={busy || !visible.length}
            checked={visible.length > 0 && visible.every((t) => selected.includes(t.id))}
            onChange={(e) =>
              setSelected(
                e.target.checked
                  ? [...new Set([...selected, ...visible.map((t) => t.id)])]
                  : selected.filter((id) => !visible.some((t) => t.id === id)),
              )
            }
          />
          Select all
        </label>
        <input
          className="grow"
          type="search"
          aria-label="Filter tabs"
          placeholder="Find a tab…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {chosen.length > 0 && (
        <div className="selection-bar stack" aria-label="Selected tabs">
          <div className="row">
            <strong>{chosen.length} selected</strong>
            <button
              className="btn"
              disabled={busy || hasPins}
              onClick={() => setGrouping(!grouping)}
              aria-expanded={grouping}
            >
              Group
            </button>
            <select
              aria-label="Move to"
              value=""
              disabled={busy || hasPins}
              onChange={(e) => {
                if (e.target.value)
                  void edit({
                    kind: 'move',
                    tabIds: chosen.map((t) => t.id),
                    windowId: Number(e.target.value),
                  });
              }}
            >
              <option value="">Move to…</option>
              {snapshot.windows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.title || 'Window ' + w.id}
                </option>
              ))}
              <option value="-1">New window</option>
            </select>
            <button
              className="btn primary"
              title="Summarize loaded text using your ChatGPT account"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void openSummary(chosen.map((t) => t.id))
                  .catch((e: Error) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              Summarize
            </button>
            <button
              className="btn quiet"
              aria-label="Clear selection"
              onClick={() => {
                setSelected([]);
                setGrouping(false);
              }}
            >
              Clear
            </button>
          </div>
          {hasPins && (
            <p className="small muted">
              Pinned tabs can be summarized. Deselect them to group or move.
            </p>
          )}
          {grouping && (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                void edit({ kind: 'group', tabIds: chosen.map((t) => t.id), title });
              }}
            >
              <input
                autoFocus
                aria-label="Group name"
                placeholder="Group name"
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
              />
              <button className="btn" disabled={busy || !title.trim()}>
                Create group
              </button>
              {groups.length > 0 && (
                <select
                  aria-label="Add to group"
                  value=""
                  onChange={(e) => {
                    if (e.target.value)
                      void edit({
                        kind: 'group',
                        tabIds: chosen.map((t) => t.id),
                        groupId: Number(e.target.value),
                      });
                  }}
                >
                  <option value="">Existing group…</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title || 'Unnamed group'}
                    </option>
                  ))}
                </select>
              )}
            </form>
          )}
        </div>
      )}
      <ul
        className="window-tabs"
        onDragEnd={() => {
          drag.current = undefined;
          setDropTarget(undefined);
        }}
      >
        {visible.map((tab, i) => {
          const group = groups.find((g) => g.id === tab.groupId);
          const groupHead = group && visible[i - 1]?.groupId !== group.id;
          return (
            <li key={tab.id}>
              {groupHead && (
                <div
                  className="tab-group-head"
                  draggable={!busy}
                  tabIndex={0}
                  aria-label={'Tab group: ' + (group.title || 'Unnamed group')}
                  onDragStart={(e) => startDrag(e, undefined, group.id)}
                  onKeyDown={(e) => keyboardMove(e, tab, true)}
                  onDragOver={(e) => {
                    if (drag.current) e.preventDefault();
                  }}
                  onDrop={(e) => drop(e, undefined, group.id)}
                >
                  <button
                    className="btn quiet"
                    aria-expanded={!folded.includes(group.id)}
                    onClick={() =>
                      setFolded((ids) =>
                        ids.includes(group.id)
                          ? ids.filter((id) => id !== group.id)
                          : [...ids, group.id],
                      )
                    }
                  >
                    {group.title || 'Unnamed group'}
                  </button>
                  <span className="small muted">
                    {tabs.filter((t) => t.groupId === group.id).length}
                  </span>
                  <details className="group-actions">
                    <summary aria-label={'Actions for ' + (group.title || 'group')}>
                      <MoreHorizontal size={16} />
                    </summary>
                    <select
                      aria-label={'Move group ' + group.title + ' to'}
                      value=""
                      onChange={(e) => {
                        if (e.target.value)
                          void edit({
                            kind: 'moveGroup',
                            groupId: group.id,
                            windowId: Number(e.target.value),
                          });
                      }}
                    >
                      <option value="">Move group to…</option>
                      {snapshot.windows.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.title || 'Window ' + w.id}
                        </option>
                      ))}
                      <option value="-1">New window</option>
                    </select>
                  </details>
                </div>
              )}
              {(!group || !folded.includes(group.id) || filter) && (
                <div
                  className={
                    'tab-row' +
                    (selected.includes(tab.id) ? ' selected' : '') +
                    (dropTarget === String(tab.id) ? ' drop-before' : '')
                  }
                  title={tab.title + '\n' + tab.url}
                  draggable={!tab.pinned && !busy}
                  tabIndex={0}
                  aria-label={tab.title}
                  onKeyDown={(e) => keyboardMove(e, tab)}
                  onDragStart={(e) => startDrag(e, tab)}
                  onDragOver={(e) => {
                    if (drag.current && !tab.pinned) {
                      e.preventDefault();
                      setDropTarget(String(tab.id));
                    }
                  }}
                  onDrop={(e) => drop(e, tab, group?.id)}
                >
                  <input
                    type="checkbox"
                    aria-label={'Select ' + tab.title}
                    checked={selected.includes(tab.id)}
                    disabled={busy}
                    onChange={(e) => toggle(tab, (e.nativeEvent as MouseEvent).shiftKey)}
                  />
                  <button className="tab-copy" onClick={(e) => toggle(tab, e.shiftKey)}>
                    <span className="tab-title">{tab.title || 'Untitled tab'}</span>
                    <span className="small muted tab-domain">
                      {hostname(tab.url)}
                      {tab.pinned ? ' · Pinned' : ''}
                    </span>
                  </button>
                </div>
              )}
            </li>
          );
        })}
        <li
          className={'tab-drop-end' + (dropTarget === 'end' ? ' drop-before' : '')}
          onDragOver={(e) => {
            if (drag.current) {
              e.preventDefault();
              setDropTarget('end');
            }
          }}
          onDrop={(e) => drop(e)}
          aria-label="End of window"
        >
          {drag.current ? 'Move to end' : ''}
        </li>
      </ul>
      {!tabs.length && <p className="empty">No tabs in this window.</p>}
    </section>
  );
}
