import { ActionLabel } from '../surface/ActionLabel';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SummaryProgress } from '../../native/protocol.mts';
import { planCall } from '../providers/chatgpt-plan';
import { requestSettings } from '../configuration/client';
import type { Configuration } from '../configuration/definition';
import { summaryConnections, type SummaryConnection } from '../digest/connection';
import { editCall, sendDigestMessage, sendWorkspaceMessage } from '../storage/client';
import { activeItem, type DigestBatch, type DigestOverview } from '../digest/types';
import { callResultLabel, digestHtml, sourceUrl } from '../digest/html';
import { openSummaryPanel } from '../digest/panel';
import type { DigestComparison } from '../digest/types';
import { ComparisonNote } from './SummaryInspection';
import { CallResults } from './CallResults';
import { createStatusObserver, type StatusObserver } from './status-observer';

async function summaryAccounts(settings: Configuration) {
  if (settings.sharedCredentials !== 'saul')
    throw new Error('Connect this app in Settings → Preferences → Integrations.');
  const result = await planCall({ action: 'accounts' });
  return summaryConnections(settings, result.accounts);
}

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
              <strong>{entry.windowTitle}</strong>
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
type SummaryLookup = { kind: 'found'; batch: DigestBatch } | { kind: 'missing' };
const missingSummary = 'This digest no longer exists.';
async function readSummary(id: string): Promise<SummaryLookup> {
  try {
    return { kind: 'found', batch: await sendDigestMessage({ action: 'get', id }) };
  } catch (cause) {
    if (cause instanceof Error && cause.message === missingSummary) return { kind: 'missing' };
    throw cause;
  }
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
  const [id, setId] = useState(() =>
    decodeURIComponent(route.split('?')[0]!.slice('#summary/'.length)),
  );
  const [tabIds] = useState(() =>
    new URLSearchParams(route.split('?')[1]).get('tabs')?.split(',').map(Number),
  );
  const [batch, setBatch] = useState<DigestBatch>();
  const [reused, setReused] = useState(false);
  const [comparisons, setComparisons] = useState<DigestComparison[]>([]);
  const [source, setSource] = useState<{ title: string; url: string }>();
  const [accounts, setAccounts] = useState<SummaryConnection[]>([]);
  const [account, setAccount] = useState('');
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [initialMissing, setInitialMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const initialized = useRef(false);
  const status = useRef<{ id: string; observer: StatusObserver<SummaryLookup> } | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const adoptBatch = useCallback((next: DigestBatch) => {
    const current = status.current;
    if (current?.id === next.id) {
      void current.observer.invalidate({ kind: 'found', batch: next });
    } else {
      current?.observer.dispose();
      status.current = null;
      setId(next.id);
      setBatch(next);
      setReadError('');
    }
  }, []);
  const start = useCallback(
    async (choiceKey?: string, regenerate = false) => {
      setBusy(true);
      setError('');
      try {
        const [call, saved] = await Promise.all([
          editCall({ action: 'status' }),
          requestSettings({ action: 'read' }),
        ]);
        if (saved.state !== 'ready') throw new Error(saved.error);
        let runAccountId: string | undefined;
        let connectionKey: string | undefined;
        if (!call.selected && !saved.settings.summaryPresetId) {
          const resolved = await summaryAccounts(saved.settings);
          if (!live.current) return;
          const key = choiceKey ?? resolved.chosen;
          setAccounts(resolved.choices);
          setAccount(key);
          const choice = resolved.choices.find((c) => c.key === key && c.available);
          if (!choice?.accountId) {
            if (!choiceKey && !regenerate && !resolved.error) return;
            throw new Error(resolved.error || 'Choose a model preset in Settings → Calls.');
          }
          runAccountId = choice.accountId;
          connectionKey = choice.key;
          const { settings, revision } = saved;
          if (settings.summaryConnectionKey !== choice.key) {
            const committed = await requestSettings({
              action: 'commit',
              baseline: revision,
              settings: { ...settings, summaryConnectionKey: choice.key },
            });
            if (committed.state !== 'ready') throw new Error(committed.error);
          }
          const catalog = await planCall({ action: 'models', accountId: runAccountId });
          if (
            !catalog.models.some(
              (m) =>
                m.slug === 'gpt-6-luna' &&
                m.supportedReasoningEfforts.some((e) => e.effort === 'medium'),
            )
          )
            throw new Error(
              'GPT-6 Luna with medium effort is unavailable. Check models in Connections.',
            );
        }
        const selected = tabIds || batch?.items.map((item) => item.tabId);
        if (!selected?.length) throw new Error('The selection is missing.');
        if (regenerate && batch) {
          for (const [index, tabId] of selected.entries()) {
            const tab = await chrome.tabs.get(tabId);
            if (tab.url !== batch.items[index]?.url)
              throw new Error(
                'A source tab changed or closed. Use Call Saul on the page you want.',
              );
          }
        }
        const targetId = regenerate ? crypto.randomUUID() : id;
        const result = await sendDigestMessage({
          action: 'start',
          id: targetId,
          tabIds: selected,
          ...(runAccountId ? { accountId: runAccountId } : {}),
          ...(connectionKey ? { connectionKey } : {}),
          ...(regenerate ? { regenerate: true } : {}),
        });
        if (!live.current) return;
        adoptBatch(result);
        setReused(result.id !== targetId);
        setComparisons([]);
        history.replaceState(null, '', '#summary/' + encodeURIComponent(result.id));
        await onResolved?.(result.id);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [adoptBatch, id, tabIds, batch, onResolved],
  );
  useEffect(() => {
    if (!visible) return;
    const observer = createStatusObserver({
      read: () => readSummary(id),
      shouldPoll: (next) => next.kind === 'found' && next.batch.items.some(activeItem),
      onSnapshot: ({ value, error }) => {
        setReadError(error ?? '');
        if (error || !value) return;
        if (value.kind === 'missing') {
          if (!initialized.current && tabIds?.length) setInitialMissing(true);
          else setError(missingSummary);
          return;
        }
        setBatch(value.batch);
        if (!initialized.current) {
          initialized.current = true;
          if (onResolved)
            void onResolved(value.batch.id).catch((cause: Error) => {
              if (status.current?.observer === observer) setError(cause.message);
            });
        }
      },
    });
    status.current = { id, observer };
    void observer.refresh();
    return () => {
      observer.dispose();
      if (status.current?.observer === observer) status.current = null;
    };
  }, [id, visible, tabIds, onResolved]);
  useEffect(() => {
    if (!visible || !initialMissing || initialized.current || !tabIds?.length) return;
    initialized.current = true;
    void (async () => {
      try {
        setBusy(true);
        const resolved = await sendDigestMessage({ action: 'resolve', id, tabIds });
        if (!live.current) return;
        setBusy(false);
        if (resolved.batch) {
          adoptBatch(resolved.batch);
          setReused(true);
          setComparisons(resolved.comparisons);
          history.replaceState(null, '', '#summary/' + encodeURIComponent(resolved.batch.id));
          await onResolved?.(resolved.batch.id);
          return;
        }
        if (tabIds.length === 1) {
          const tab = await chrome.tabs.get(tabIds[0]!);
          if (!live.current) return;
          setSource({ title: tab.title || 'Untitled page', url: tab.url || '' });
        }
        await start();
      } catch (e) {
        if (live.current) {
          setError((e as Error).message);
          setBusy(false);
        }
      }
    })();
  }, [adoptBatch, id, initialMissing, onResolved, start, tabIds, visible]);
  const running = Boolean(batch?.items.some(activeItem));
  async function control(action: 'stop' | 'retry' | 'delete') {
    setBusy(true);
    setError('');
    try {
      if (action === 'delete') {
        await sendDigestMessage({ action, id });
        if (!live.current) return;
        status.current?.observer.dispose();
        location.hash = 'summaries';
      } else {
        const next = await sendDigestMessage({ action, id });
        if (live.current) adoptBatch(next);
      }
    } catch (e) {
      if (live.current) {
        setError((e as Error).message);
        void status.current?.observer.invalidate();
      }
    } finally {
      if (live.current) setBusy(false);
    }
  }
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
          <h2>{single ? page?.title || 'Page summary' : batch?.windowTitle || 'Summary'}</h2>
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
          <button
            type="button"
            className="btn"
            onClick={() => void status.current?.observer.refresh()}
          >
            Refresh status
          </button>
        </div>
      )}
      {!batch && tabIds && (
        <div className="stack">
          {accounts.length > 0 && (
            <label className="field">
              ChatGPT plan connection
              <select value={account} onChange={(e) => setAccount(e.target.value)}>
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
