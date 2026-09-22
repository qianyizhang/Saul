import { useEffect, useState } from 'react';
import { NativeBridge } from './NativeBridge';
import { sendWorkspaceMessage } from '../storage/client';

import type {
  TabSnapshot,
  WorkspacePreviewArgs,
  WorkspacePreviewRequest,
  WorkspacePreviewResult,
  WorkspaceRequest,
  WorkspaceTool,
} from '../native/workspace';

type SortBy = WorkspacePreviewArgs<'saul_tabs_sort'>['by'];
type GroupColor = NonNullable<WorkspacePreviewArgs<'saul_tabs_group'>['color']>;
type PreviewState = WorkspacePreviewResult & { request: WorkspacePreviewRequest };

export function Tabs() {
  const [snapshot, setSnapshot] = useState<TabSnapshot>({ windows: [], tabs: [], groups: [] });
  const [windowId, setWindow] = useState<number>();
  const [selected, select] = useState<number[]>([]);
  const [by, setBy] = useState<SortBy>('domain');
  const [title, setTitle] = useState('Research');
  const [color, setColor] = useState<GroupColor>('blue');
  const [destination, setDestination] = useState<number>();
  const [preview, setPreview] = useState<PreviewState>();
  const [undo, setUndo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function perform(payload: WorkspaceRequest) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (payload.action === 'preview') {
        const result = await sendWorkspaceMessage(payload);
        setPreview({ ...result, request: payload });
      } else {
        const result = await sendWorkspaceMessage(payload);
        setPreview(undefined);
        setSnapshot(result.snapshot);
        setUndo(result.canUndo);
        setWindow((current) =>
          result.snapshot.windows.some((w) => w.id === current)
            ? current
            : (result.snapshot.windows.find((w) => w.focused)?.id ??
              result.snapshot.windows[0]?.id),
        );
        select([]);
        if (payload.action !== 'list')
          setNotice(
            payload.action === 'undo' ? 'Previous tab order restored.' : 'Changes applied.',
          );
      }
    } catch (err) {
      if (payload.action === 'apply' || payload.action === 'undo') setUndo(false);
      setError(
        (err as Error).message +
          (payload.action === 'apply' || payload.action === 'undo'
            ? ' Some browser changes may have completed; refresh before retrying.'
            : ''),
      );
      setPreview(undefined);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void perform({ action: 'list' });
  }, []);
  const tabs = snapshot.tabs.filter((t) => t.windowId === windowId);
  const draft = <K extends WorkspaceTool>(method: K, args: WorkspacePreviewArgs<NoInfer<K>>) =>
    perform({ action: 'preview', method, args } as WorkspacePreviewRequest<K>);
  const previewIds = preview?.plan && 'tabIds' in preview.plan ? preview.plan.tabIds : [];
  const previewTitle =
    preview && 'title' in preview.request.args ? preview.request.args.title : undefined;
  const previewColor =
    preview && 'color' in preview.request.args ? preview.request.args.color : undefined;
  const previewWindow =
    preview && 'windowId' in preview.request.args ? preview.request.args.windowId : undefined;
  const groups = snapshot.groups.filter((g) => g.windowId === windowId);
  return (
    <div className="stack">
      <div className="row between">
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Tabs</h2>
          <p className="muted small">
            Preview changes before applying them. Pinned tabs stay protected.
          </p>
        </div>
        <button className="btn" disabled={busy} onClick={() => perform({ action: 'list' })}>
          Refresh tabs
        </button>
      </div>
      <NativeBridge />
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice success">
          {notice}
        </p>
      )}
      <div className="panel stack">
        <div className="row">
          <label className="field grow">
            Window
            <select
              aria-label="Window"
              value={windowId ?? ''}
              onChange={(e) => {
                setWindow(Number(e.target.value));
                select([]);
                setPreview(undefined);
              }}
            >
              {snapshot.windows.map((w) => (
                <option key={w.id} value={w.id}>
                  Window {w.id}
                  {w.focused ? ' · current' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Sort by
            <select
              aria-label="Sort by"
              value={by}
              onChange={(e) => setBy(e.target.value as SortBy)}
            >
              <option value="domain">Website</option>
              <option value="title">Title</option>
            </select>
          </label>
        </div>
        <div className="row">
          <button
            className="btn"
            disabled={busy || !tabs.length}
            onClick={() => {
              if (windowId !== undefined) void draft('saul_tabs_sort', { windowId, by });
            }}
          >
            Preview sort
          </button>
          <button
            className="btn"
            disabled={busy || !undo}
            onClick={() => perform({ action: 'undo' })}
          >
            Undo last sort
          </button>
        </div>
        <p className="small muted">
          Existing groups move together. Undo is available while the tab layout remains unchanged.
        </p>
      </div>
      {preview && (
        <section className="panel stack" aria-label="Tab change preview">
          <h3>Review changes</h3>
          <p>
            {preview.request.method === 'saul_tabs_sort'
              ? 'Proposed tab order'
              : preview.request.method === 'saul_tabs_group'
                ? `Group ${previewIds.length} selected tabs${previewTitle ? ` as “${previewTitle}”` : ''}`
                : preview.request.method === 'saul_tabs_move'
                  ? `Move selected tabs to window ${previewWindow}`
                  : preview.request.method === 'saul_groups_update'
                    ? 'Update group details'
                    : 'Ungroup selected tabs'}
          </p>
          {previewTitle !== undefined && (
            <p className="small muted">
              Name: {previewTitle || 'Unnamed group'} · Color: {previewColor || 'unchanged'}
            </p>
          )}
          <ol style={{ maxHeight: 260, overflow: 'auto', paddingLeft: 24 }}>
            {previewIds.map((id: number) => (
              <li key={id}>
                {preview.snapshot.tabs.find((t) => t.id === id)?.title || `Tab ${id}`}
              </li>
            ))}
          </ol>
          <div className="row">
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => perform({ action: 'apply', token: preview.token })}
            >
              Apply changes
            </button>
            <button className="btn" onClick={() => setPreview(undefined)}>
              Cancel preview
            </button>
          </div>
        </section>
      )}
      <ul className="tabs-list">
        {tabs.map((tab) => (
          <li key={tab.id} className="tab-row">
            <input
              type="checkbox"
              aria-label={`Select ${tab.title}`}
              disabled={tab.pinned || busy}
              checked={selected.includes(tab.id)}
              onChange={(e) => {
                select((ids) =>
                  e.target.checked ? [...ids, tab.id] : ids.filter((id) => id !== tab.id),
                );
                setPreview(undefined);
              }}
            />
            <div className="grow">
              <div>{tab.title || 'Untitled tab'}</div>
              <div className="small muted truncate">{tab.url}</div>
              <div className="small muted">
                {tab.pinned
                  ? 'Pinned'
                  : tab.groupId >= 0
                    ? snapshot.groups.find((g) => g.id === tab.groupId)?.title || 'Unnamed group'
                    : ''}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {!busy && !tabs.length && <p className="empty">No tabs in this window.</p>}
      <section className="panel stack">
        <h3>{selected.length} tabs selected</h3>
        <div className="row">
          <label className="field grow">
            Group name
            <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">
            Color
            <select
              aria-label="Color"
              value={color}
              onChange={(e) => setColor(e.target.value as GroupColor)}
            >
              {['blue', 'green', 'yellow', 'red', 'purple', 'pink', 'orange', 'cyan', 'grey'].map(
                (c) => (
                  <option key={c}>{c}</option>
                ),
              )}
            </select>
          </label>
        </div>
        <div className="row">
          <button
            className="btn"
            disabled={busy || !selected.length}
            onClick={() => draft('saul_tabs_group', { tabIds: selected, title, color })}
          >
            Preview group
          </button>
          <button
            className="btn"
            disabled={busy || !selected.length}
            onClick={() => draft('saul_tabs_ungroup', { tabIds: selected })}
          >
            Preview ungroup
          </button>
        </div>
        {groups.length > 0 && (
          <label className="field">
            Add selected tabs to an existing group
            <select
              value=""
              disabled={busy || !selected.length}
              onChange={(e) => {
                if (e.target.value)
                  void draft('saul_tabs_group', {
                    tabIds: selected,
                    groupId: Number(e.target.value),
                  });
              }}
            >
              <option value="">Choose group…</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title || 'Unnamed group'}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="row">
          <label className="field grow">
            Move to window
            <select
              aria-label="Move to window"
              value={destination ?? ''}
              onChange={(e) => setDestination(e.target.value ? Number(e.target.value) : undefined)}
            >
              <option value="">Choose window…</option>
              {snapshot.windows.map((w) => (
                <option key={w.id} value={w.id}>
                  Window {w.id}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn"
            disabled={busy || !selected.length || destination === undefined}
            onClick={() => {
              if (destination !== undefined)
                void draft('saul_tabs_move', {
                  tabIds: selected,
                  windowId: destination,
                  index: -1,
                });
            }}
          >
            Preview move
          </button>
        </div>
        <p className="small muted">Moving requires ungrouped tabs. Ungroup them first if needed.</p>
        {groups.length > 0 && (
          <details>
            <summary>Rename or recolor an existing group</summary>
            <p className="small muted">Uses the group name and color above.</p>
            {groups.map((g) => (
              <button
                className="btn"
                key={g.id}
                disabled={busy}
                onClick={() => draft('saul_groups_update', { groupId: g.id, title, color })}
              >
                Update {g.title || 'Unnamed group'}
              </button>
            ))}
          </details>
        )}
      </section>
    </div>
  );
}
