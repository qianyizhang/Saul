import { ActionLabel } from '../../ui/ActionLabel';
import { useEffect, useState } from 'react';
import type { SummaryProgress } from '../../../shared/protocol/protocol.mts';
import { sendDigestMessage } from '../client';
import { sendWorkspaceMessage } from '../../native/workspace-client';
import { activeItem, summaryTitle, type DigestOverview } from '../../../shared/model/call-batch.ts';
import { callResultLabel, digestHtml, sourceUrl } from './summary-html';
import { openSummaryPanel } from '../panel-route';
import { ComparisonNote } from './SummaryInspection';
import { CallResults } from './CallResults';
import { createStatusObserver } from '../../observation/status-observer';
import { useSummarySession } from '../summary-session';

export function openSummary(tabIds: number[], windowId: number) {
  return openSummaryPanel(windowId, { tabIds });
}
function useSummaryWindow() {
  const [windowId, setWindowId] = useState<number>();
  useEffect(() => {
    let disposed = false;
    void chrome.windows
      .getCurrent()
      .then((window) => {
        if (!disposed) setWindowId(window.id);
      })
      .catch((error) => console.warn('[Saul] Could not identify the summary window', error));
    return () => {
      disposed = true;
    };
  }, []);
  return windowId;
}
export function ActiveSummary() {
  const windowId = useSummaryWindow();
  const [active, setActive] = useState<SummaryProgress | null>(null);
  useEffect(() => {
    const observer = createStatusObserver({
      read: () =>
        sendWorkspaceMessage({
          action: 'command',
          method: 'saul_summary_status',
          args: {},
        }),
      // This indicator discovers new work while Window is open. The reader owns
      // the lifecycle and error display for an individual summary.
      shouldPoll: () => true,
      onSnapshot: ({ value }) => {
        if (value !== undefined) setActive(value);
      },
      intervalMs: 2000,
    });
    void observer.refresh();
    return () => observer.dispose();
  }, []);
  return (
    active && (
      <a
        className="small summary-progress"
        href={chrome.runtime.getURL('/library.html#summary/' + active.id)}
        target="_blank"
        onClick={(event) => {
          event.preventDefault();
          if (windowId !== undefined)
            void openSummaryPanel(windowId, { id: active.id }).catch(console.warn);
        }}
      >
        Summarizing {active.completed} of {active.total} · Open
      </a>
    )
  );
}
export function SummaryHistory({ onOpen }: { onOpen?: (id: string) => void } = {}) {
  const windowId = useSummaryWindow();
  const [entries, setEntries] = useState<DigestOverview[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void sendDigestMessage({ action: 'list' })
      .then(setEntries, (e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  return (
    <section aria-label="Saved summaries" className="stack">
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {!loading && !entries.length && (
        <p className="empty">
          No saved summaries. Right-click a page and choose Call Saul, or select tabs in Window.
        </p>
      )}
      {loading && <p role="status">Loading…</p>}
      <ul className="summary-history">
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              className="summary-entry"
              disabled={!onOpen && windowId === undefined}
              onClick={() => {
                if (onOpen) onOpen(entry.id);
                else if (windowId !== undefined)
                  void openSummaryPanel(windowId, { id: entry.id }).catch((e: Error) =>
                    setError(e.message),
                  );
              }}
            >
              <strong>{entry.title || entry.windowTitle}</strong>
              <span className="small muted standard-only">
                {new Date(entry.createdAt).toLocaleString()}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
export function SummaryReader({
  route,
  sidePanel = false,
  visible = true,
  onClose,
  onResolved,
}: {
  route: string;
  sidePanel?: boolean;
  visible?: boolean;
  onClose?: () => void;
  onResolved?: (id: string) => Promise<void>;
}) {
  const {
    batch,
    reused,
    comparisons,
    source,
    accounts,
    account,
    selectAccount,
    error,
    readError,
    busy,
    tabIds,
    start,
    running,
    control,
    refresh,
  } = useSummarySession({ route, visible, onResolved });
  function download() {
    if (!batch) return;
    const url = URL.createObjectURL(
      new Blob([digestHtml(batch)], { type: 'text/html;charset=utf-8' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'saul-summary-' + batch.id + '.html';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const done = batch?.items.filter((i) => i.status === 'completed').length || 0;
  const settled = batch?.items.filter((i) => !activeItem(i)).length || 0;
  const singleItem = batch?.items.length === 1 ? batch.items[0] : undefined;
  const single = batch ? Boolean(singleItem) : tabIds?.length === 1;
  const page = singleItem || source;
  const pageUrl = page && sourceUrl(page.url);
  const title = batch
    ? summaryTitle(batch.items[0], batch.items.length)
    : single
      ? summaryTitle(source, 1)
      : 'Summary';
  const custom = Boolean(batch?.action);
  const statusLabel = singleItem
    ? {
        queued: custom ? 'Waiting to run…' : 'Waiting to summarize…',
        capturing: 'Reading page…',
        running: custom ? 'Running call…' : 'Generating summary…',
        saving: custom ? 'Saving call result…' : 'Saving summary…',
        completed: custom ? 'Call complete' : 'Summary ready',
        cancelled: custom ? 'Call stopped' : 'Summary stopped',
        interrupted: custom ? 'Call interrupted' : 'Summary interrupted',
        failed: custom ? 'Call failed' : 'Could not summarize page',
        skipped: 'Page unavailable',
      }[singleItem.status]
    : `${done} of ${batch?.items.length || 0} ${custom ? 'complete' : 'summarized'} · ${settled} processed${running ? ' · Working…' : ''}`;
  return (
    <article className="summary-reader stack" aria-label="Summary reader">
      <div className="row between">
        <a
          className="small"
          href="#summaries"
          aria-label="← Saved summaries"
          title="← Saved summaries"
        >
          <ActionLabel short="History" full="← Saved summaries" />
        </a>
        {onClose && (
          <button className="btn quiet" onClick={onClose} aria-label="Close summary panel">
            Close
          </button>
        )}
      </div>
      <header className="row between">
        <div>
          <h2>{title}</h2>
          {single && pageUrl ? (
            <a className="small" href={pageUrl} target="_blank" rel="noreferrer">
              Open source · {new URL(pageUrl).hostname}
            </a>
          ) : (
            <p className="small muted">
              {batch ? new Date(batch.createdAt).toLocaleString() : 'Preparing selected tabs…'}
            </p>
          )}
        </div>
        {batch && (
          <button
            className="btn standard-only"
            onClick={download}
            aria-label="Export HTML"
            title="Export HTML"
          >
            <ActionLabel short="Export" full="Export HTML" />
          </button>
        )}
        {batch && (
          <details className="minimum-only summary-tools">
            <summary>More</summary>
            <div className="row">
              <button
                className="btn"
                aria-label="Export HTML"
                title="Export HTML"
                onClick={download}
              >
                Export
              </button>
              {!running && (
                <button
                  className="btn"
                  aria-label="Run again"
                  title="Run again with current settings"
                  disabled={busy}
                  onClick={() => void start(undefined, true)}
                >
                  Run again
                </button>
              )}
            </div>
          </details>
        )}
      </header>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {readError && (
        <div className="row between notice error">
          <span role="alert">Could not read summary status: {readError}</span>
          <button type="button" className="btn" onClick={() => void refresh()}>
            Refresh status
          </button>
        </div>
      )}
      {!batch && tabIds && (
        <div className="stack">
          {accounts.length > 0 && (
            <label className="field">
              ChatGPT plan connection
              <select value={account} onChange={(e) => selectAccount(e.target.value)}>
                <option value="">Choose connection…</option>
                {accounts.map((a) => (
                  <option key={a.key} value={a.key} disabled={!a.available}>
                    {a.name}
                    {!a.available ? ' · setup required' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!busy && accounts.length > 0 && (
            <button
              className="btn primary"
              disabled={!account}
              onClick={() => void start(account)}
              aria-label="Start summary"
              title="Start summary"
            >
              <ActionLabel short="Summarize" full="Start summary" />
            </button>
          )}
          {error && (
            <a
              href={sidePanel ? chrome.runtime.getURL('/library.html#settings') : '#settings'}
              target={sidePanel ? '_blank' : undefined}
              rel={sidePanel ? 'noreferrer' : undefined}
              aria-label="Open Settings"
              title="Open Settings"
            >
              <ActionLabel short="Settings" full="Open Settings" />
            </a>
          )}
          {busy && <p role="status">Starting…</p>}
        </div>
      )}
      {batch && (
        <>
          {reused && (
            <aside className="notice summary-reuse" aria-label="Saved summary reused">
              <strong>
                {running
                  ? 'Existing summary reopened'
                  : batch.items.every((item) => item.status === 'completed')
                    ? 'Saved summary reused'
                    : 'Saved attempt reopened'}
              </strong>
              <p className="small">
                {new Date(batch.createdAt).toLocaleString()} · No new model request.
              </p>
              {comparisons.map((comparison) => (
                <div key={comparison.index}>
                  {!single && <p className="small">{batch.items[comparison.index]?.title}</p>}
                  <ComparisonNote comparison={comparison} />
                </div>
              ))}
              {!comparisons.length && (
                <p className="small">Current page input has not been compared.</p>
              )}
            </aside>
          )}
          <div className="row between">
            <p role="status">{statusLabel}</p>
            {running && (
              <button className="btn" disabled={busy} onClick={() => void control('stop')}>
                Stop
              </button>
            )}
            {!running &&
              batch.items.some((i) =>
                ['failed', 'interrupted', 'cancelled'].includes(i.status),
              ) && (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => void control('retry')}
                  aria-label="Retry unfinished"
                  title="Retry unfinished"
                >
                  <ActionLabel short="Retry" full="Retry unfinished" />
                </button>
              )}
            {!running && (
              <button
                className="btn quiet standard-only"
                disabled={busy}
                onClick={() => void start(undefined, true)}
              >
                {busy ? 'Starting…' : 'Run again'}
              </button>
            )}
          </div>
          {running && (
            <progress aria-label="Summary progress" value={settled} max={batch.items.length} />
          )}
          {batch.error && (
            <p role="alert" className="notice error">
              {batch.error}
            </p>
          )}
          <details>
            <summary>Details</summary>
            <p className="small muted">
              {batch.action
                ? `${callResultLabel(batch)} · revision ${batch.action.revision.revision.slice(0, 10)}.`
                : `English → 简体中文 · ${callResultLabel(batch)}.`}{' '}
              <span className="standard-only">
                Summaries and prepared input are saved locally. Closing this reader does not stop
                work.
              </span>
            </p>
            {!running && (
              <button
                className="btn danger"
                disabled={busy}
                onClick={() => {
                  if (confirm('Delete this saved summary and captured source text?'))
                    void control('delete');
                }}
                aria-label="Delete summary"
                title="Delete summary"
              >
                <ActionLabel short="Delete" full="Delete summary" />
              </button>
            )}
          </details>
          <CallResults batch={batch} tabIds={tabIds} />
        </>
      )}
    </article>
  );
}
