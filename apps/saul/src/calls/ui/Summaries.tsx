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
  panelWindowId,
  visible = true,
  onClose,
  onResolved,
}: {
  route: string;
  panelWindowId?: number;
  visible?: boolean;
  onClose?: () => void;
  onResolved?: (id: string) => Promise<void>;
}) {
  const {
    batch,
    reused,
    comparisons,
    source,
    setup,
    setupTabId,
    preset,
    selectPreset,
    confirmSetup,
    cancelSetup,
    error,
    readError,
    busy,
    tabIds,
    runAgain,
    running,
    control,
    refresh,
  } = useSummarySession({ route, panelWindowId, visible, onResolved });
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
  const page = setup?.source || singleItem || source;
  const pageUrl = page && sourceUrl(page.url);
  const title = batch
    ? summaryTitle(batch.items[0], batch.items.length)
    : single
      ? summaryTitle(page, 1)
      : tabIds && tabIds.length > 1
        ? `${tabIds.length} selected pages`
        : 'Summary';
  const custom = Boolean(batch?.action);
  const pickPreset = Boolean(
    setup?.reason === 'choose' || (setup?.reason === 'changed' && !setup.presetId),
  );
  const showPicker = Boolean(pickPreset && setup?.presets.length);
  const brokenPreset = setup?.reason === 'repair';
  const editPreset = brokenPreset && setup.presetName ? setup.presetId : undefined;
  const presetSettings = chrome.runtime.getURL(
    '/library.html?section=' +
      (brokenPreset && !editPreset ? 'calls' : 'models') +
      (editPreset ? '&preset=' + encodeURIComponent(editPreset) : '') +
      '#settings',
  );
  const [sourceError, setSourceError] = useState('');
  const returnToSource = async () => {
    if (setupTabId === undefined || !pageUrl) return;
    try {
      const tab = await chrome.tabs.get(setupTabId);
      if (tab.url !== pageUrl)
        throw new Error('The source tab has changed. Open the source to try again.');
      await chrome.tabs.update(setupTabId, { active: true });
      onClose?.();
      setSourceError('');
    } catch (cause) {
      setSourceError(cause instanceof Error ? cause.message : String(cause));
    }
  };
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
          {single && pageUrl && (!setup || sourceError) ? (
            <a className="small" href={pageUrl} target="_blank" rel="noreferrer">
              Open source · {new URL(pageUrl).hostname}
            </a>
          ) : batch && !single ? (
            <p className="small muted">{new Date(batch.createdAt).toLocaleString()}</p>
          ) : null}
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
                  disabled={busy || Boolean(setup)}
                  onClick={() => void runAgain()}
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
      {setup && (
        <section className="panel stack call-setup" aria-label="Call setup">
          <p
            className={setup.reason === 'repair' ? 'notice error' : undefined}
            role={brokenPreset ? 'alert' : batch ? undefined : 'status'}
            aria-live={batch && !brokenPreset ? 'polite' : undefined}
          >
            {brokenPreset && setup.presetName && (
              <>
                <strong>{setup.presetName}</strong>
                <br />
              </>
            )}
            {setup.message}
          </p>
          {setup.reason === 'changed' && (
            <>
              {setup.routeLabel && <p>{setup.routeLabel}</p>}
              {setup.reviewSources?.length ? (
                <ol className="call-setup-sources" aria-label="Sources in run order">
                  {setup.reviewSources.map((item, index) => {
                    const url = sourceUrl(item.url);
                    return (
                      <li key={index}>
                        {(batch || !single) && <strong>{item.title}</strong>}
                        {url && (
                          <a className="small" href={url} target="_blank" rel="noreferrer">
                            {url}
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ol>
              ) : null}
            </>
          )}
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              if (preset && showPicker) void confirmSetup();
            }}
          >
            {showPicker && (
              <label className="field">
                Write preset
                <select
                  name="preset"
                  value={preset}
                  disabled={busy}
                  required
                  onChange={(event) => selectPreset(event.target.value)}
                >
                  <option value="">Choose preset…</option>
                  {setup.presets.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="row">
              {showPicker && (
                <button className="btn primary" type="submit" disabled={!preset || busy}>
                  Save and start
                </button>
              )}
              {setup.reason === 'changed' && !pickPreset && (
                <button
                  className="btn primary"
                  type="button"
                  disabled={busy}
                  onClick={() => void confirmSetup()}
                >
                  Continue
                </button>
              )}
              {(brokenPreset || (pickPreset && !showPicker)) && (
                <a className="btn" href={presetSettings} target="_blank" rel="noreferrer">
                  {editPreset ? 'Edit preset' : brokenPreset ? 'Open Calls' : 'Open presets'}
                </a>
              )}
              {batch && (
                <button className="btn quiet" type="button" disabled={busy} onClick={cancelSetup}>
                  Cancel
                </button>
              )}
              {setupTabId !== undefined && pageUrl && (
                <button
                  className="btn quiet"
                  type="button"
                  disabled={busy}
                  onClick={() => void returnToSource()}
                >
                  Return to source
                </button>
              )}
            </div>
          </form>
          {sourceError && (
            <p role="alert" className="notice error">
              {sourceError}
            </p>
          )}
        </section>
      )}
      {!batch && !setup && busy && <p role="status">Starting…</p>}
      {!batch && !setup && error && (
        <a href={chrome.runtime.getURL('/library.html#settings')} target="_blank" rel="noreferrer">
          Open Settings
        </a>
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
                  {!single && (
                    <p className="small">
                      {batch.items.find((item) => item.index === comparison.index)?.title}
                    </p>
                  )}
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
                disabled={busy || Boolean(setup)}
                onClick={() => void runAgain()}
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
