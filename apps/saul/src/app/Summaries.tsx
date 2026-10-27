import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlanAccount } from '../../native/plan-protocol.mts';
import type { SummaryProgress } from '../../native/protocol.mts';
import { planCall } from '../models/chatgpt-plan';
import { getSettings } from '../storage/settings';
import { sendDigestMessage, sendWorkspaceMessage } from '../storage/client';
import { activeItem, type DigestBatch, type DigestOverview, type Pair } from '../digest/types';
import { digestHtml, sourceUrl } from '../digest/html';
import { openSummaryPanel } from '../digest/panel';
import type { DigestComparison } from '../digest/types';
import { ComparisonNote, SummaryInspection } from './SummaryInspection';

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
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await sendWorkspaceMessage({
          action: 'command',
          method: 'saul_summary_status',
          args: {},
        });
        if (!disposed) setActive(next);
      } catch {
        /* Action and reader errors have their own recovery surfaces. */
      } finally {
        if (!disposed) timer = setTimeout(() => void refresh(), 2000);
      }
    };
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
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
          No saved summaries. Right-click a page and choose Saul Summarize, or select tabs in
          Window.
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
              <span className="small muted">{new Date(entry.createdAt).toLocaleString()}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
function Bilingual({ pair }: { pair: Pair }) {
  return (
    <>
      <p lang="en">{pair.en}</p>
      <p lang="zh-Hans" className="translation">
        {pair.zh}
      </p>
    </>
  );
}
export function SummaryReader({
  route,
  sidePanel = false,
  onClose,
  onResolved,
}: {
  route: string;
  sidePanel?: boolean;
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
  const [accounts, setAccounts] = useState<PlanAccount[]>([]);
  const [account, setAccount] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const initialized = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const start = useCallback(
    async (accountId: string, regenerate = false) => {
      setBusy(true);
      setError('');
      try {
        const catalog = await planCall({ action: 'models', accountId });
        if (
          !catalog.models.some(
            (m) =>
              m.slug === 'gpt-6-luna' &&
              m.supportedReasoningEfforts.some((e) => e.effort === 'medium'),
          )
        )
          throw new Error(
            'GPT-6 Luna with medium effort is unavailable. Refresh models in Settings.',
          );
        const selected = tabIds || batch?.items.map((item) => item.tabId);
        if (!selected?.length) throw new Error('The selection is missing.');
        if (regenerate && batch) {
          for (const [index, tabId] of selected.entries()) {
            const tab = await chrome.tabs.get(tabId);
            if (tab.url !== batch.items[index]?.url)
              throw new Error(
                'A source tab changed or closed. Use Saul Summarize on the page you want.',
              );
          }
        }
        const targetId = regenerate ? crypto.randomUUID() : id;
        const result = await sendDigestMessage({
          action: 'start',
          id: targetId,
          tabIds: selected,
          accountId,
          ...(regenerate ? { regenerate: true } : {}),
        });
        if (!live.current) return;
        setId(result.id);
        setBatch(result);
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
    [id, tabIds, batch, onResolved],
  );
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void (async () => {
      try {
        try {
          const existing = await sendDigestMessage({ action: 'get', id });
          if (!live.current) return;
          setBatch(existing);
          await onResolved?.(existing.id);
          return;
        } catch (e) {
          if (!tabIds || !(e as Error).message.includes('no longer exists')) throw e;
        }
        if (tabIds?.length) {
          setBusy(true);
          const resolved = await sendDigestMessage({ action: 'resolve', id, tabIds });
          if (!live.current) return;
          setBusy(false);
          if (resolved.batch) {
            setId(resolved.batch.id);
            setBatch(resolved.batch);
            setReused(true);
            setComparisons(resolved.comparisons);
            history.replaceState(null, '', '#summary/' + encodeURIComponent(resolved.batch.id));
            await onResolved?.(resolved.batch.id);
            return;
          }
        }
        if (tabIds?.length === 1) {
          const tab = await chrome.tabs.get(tabIds[0]!);
          setSource({ title: tab.title || 'Untitled page', url: tab.url || '' });
        }
        const [result, settings] = await Promise.all([
          planCall({ action: 'accounts' }),
          getSettings(),
        ]);
        if (!live.current) return;
        const eligible = result.accounts.filter((a) => a.signedIn && a.planEnabled);
        setAccounts(eligible);
        const chosen =
          eligible.find((a) => a.id === settings.chatgptPlan?.accountId)?.id ||
          (eligible.length === 1 ? eligible[0]!.id : '');
        setAccount(chosen);
        if (chosen) await start(chosen);
        else if (!eligible.length)
          setError('Sign in with ChatGPT and enable plan usage in Settings to summarize tabs.');
      } catch (e) {
        setError((e as Error).message);
        setBusy(false);
      }
    })();
  }, [id, start, tabIds, onResolved]);
  const running = Boolean(batch?.items.some(activeItem));
  useEffect(() => {
    if (!running) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await sendDigestMessage({ action: 'get', id });
        if (!disposed) {
          setBatch(next);
          if (next.items.some(activeItem)) timer = setTimeout(() => void refresh(), 700);
        }
      } catch (e) {
        if (!disposed) setError((e as Error).message);
      }
    };
    timer = setTimeout(() => void refresh(), 700);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [id, running]);
  async function control(action: 'stop' | 'retry' | 'delete') {
    setBusy(true);
    setError('');
    try {
      if (action === 'delete') {
        await sendDigestMessage({ action, id });
        location.hash = 'summaries';
      } else setBatch(await sendDigestMessage({ action, id }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
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
  const multipleWindows = new Set(batch?.items.map((i) => i.windowId)).size > 1;
  const done = batch?.items.filter((i) => i.status === 'completed').length || 0;
  const settled = batch?.items.filter((i) => !activeItem(i)).length || 0;
  const singleItem = batch?.items.length === 1 ? batch.items[0] : undefined;
  const single = batch ? Boolean(singleItem) : tabIds?.length === 1;
  const page = singleItem || source;
  const pageUrl = page && sourceUrl(page.url);
  const status = singleItem
    ? {
        queued: 'Waiting to summarize…',
        capturing: 'Reading page…',
        running: 'Generating summary…',
        completed: 'Summary ready',
        cancelled: 'Summary stopped',
        interrupted: 'Summary interrupted',
        failed: 'Could not summarize page',
        skipped: 'Page unavailable',
      }[singleItem.status]
    : `${done} of ${batch?.items.length || 0} summarized · ${settled} processed${running ? ' · Working…' : ''}`;
  return (
    <article className="summary-reader stack" aria-label="Summary reader">
      <div className="row between">
        <a className="small" href="#summaries">
          ← Saved summaries
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
          <button className="btn" onClick={download}>
            Export HTML
          </button>
        )}
      </header>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {!batch && tabIds && (
        <div className="stack">
          <p className="small muted">
            Summarizes loaded tab text with your ChatGPT account. Video, audio, images, and unloaded
            content are not read.
          </p>
          {accounts.length > 1 && (
            <label className="field">
              Summary account
              <select value={account} onChange={(e) => setAccount(e.target.value)}>
                <option value="">Choose account…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!busy && accounts.length > 0 && (
            <button className="btn primary" disabled={!account} onClick={() => void start(account)}>
              Start summary
            </button>
          )}
          {!accounts.length && error && (
            <a
              href={sidePanel ? chrome.runtime.getURL('/library.html#settings') : '#settings'}
              target={sidePanel ? '_blank' : undefined}
              rel={sidePanel ? 'noreferrer' : undefined}
            >
              Open Settings
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
            <p role="status">{status}</p>
            {running && (
              <button className="btn" disabled={busy} onClick={() => void control('stop')}>
                Stop
              </button>
            )}
            {!running &&
              batch.items.some((i) =>
                ['failed', 'interrupted', 'cancelled'].includes(i.status),
              ) && (
                <button className="btn" disabled={busy} onClick={() => void control('retry')}>
                  Retry unfinished
                </button>
              )}
            {!running && (
              <button
                className="btn quiet"
                disabled={busy}
                onClick={() => void start(batch.accountId, true)}
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
              English → 简体中文 · Luna medium. Summaries and captured text are saved locally.
              Closing this reader does not stop work.
            </p>
            {!running && (
              <button
                className="btn danger"
                disabled={busy}
                onClick={() => {
                  if (confirm('Delete this saved summary and captured source text?'))
                    void control('delete');
                }}
              >
                Delete summary
              </button>
            )}
          </details>
          {singleItem && (
            <SummaryInspection
              key={batch.id}
              batch={batch}
              item={singleItem}
              tabId={tabIds?.[0] ?? singleItem.tabId}
            />
          )}
          <ol className="summary-items">
            {batch.items.map((item) => (
              <li key={item.index}>
                {!single && (
                  <div className="small muted">
                    {multipleWindows ? (item.windowTitle || batch.windowTitle) + ' · ' : ''}
                    {item.status === 'completed' ? '' : item.status}
                  </div>
                )}
                {!single && (
                  <h3>
                    {sourceUrl(item.url) ? (
                      <a href={item.url} target="_blank" rel="noreferrer">
                        {item.title}
                      </a>
                    ) : (
                      item.title
                    )}
                  </h3>
                )}
                {item.error && (
                  <p className={item.status === 'skipped' ? 'small muted' : 'notice error'}>
                    {item.error}
                  </p>
                )}
                {!single && (
                  <SummaryInspection
                    key={batch.id + ':' + item.index}
                    batch={batch}
                    item={item}
                    tabId={tabIds?.[item.index] ?? item.tabId}
                  />
                )}
                {item.summary && (
                  <>
                    <Bilingual pair={item.summary.lead} />
                    <ul className="summary-points">
                      {item.summary.points.map((point, i) => (
                        <li key={i}>
                          <Bilingual pair={point} />
                        </li>
                      ))}
                    </ul>
                    {item.summary.caution && (
                      <aside className="summary-caution">
                        <Bilingual pair={item.summary.caution} />
                      </aside>
                    )}
                    {(item.summary.flow.length > 0 ||
                      item.summary.terms.length > 0 ||
                      item.summary.question) && (
                      <details>
                        <summary>Go deeper</summary>
                        {[
                          ...item.summary.flow,
                          ...item.summary.terms,
                          ...(item.summary.question ? [item.summary.question] : []),
                        ].map((pair, i) => (
                          <Bilingual key={i} pair={pair} />
                        ))}
                      </details>
                    )}
                  </>
                )}
                {(item.coverage || item.capturedAt) && (
                  <details>
                    <summary>Source coverage</summary>
                    <p className="small muted">{item.coverage}</p>
                    {item.capturedAt && (
                      <p className="small muted">
                        Captured {new Date(item.capturedAt).toLocaleString()}
                      </p>
                    )}
                  </details>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </article>
  );
}
