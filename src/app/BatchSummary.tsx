import { useEffect, useState } from 'react';
import { sendDigestMessage } from '../storage/client';
import { planCall } from '../models/chatgpt-plan';
import { getSettings } from '../storage/settings';
import type { PlanAccount } from '../../native/plan-protocol.mjs';
import { activeItem, type DigestBatch, type DigestOverview } from '../digest/types';
import { digestHtml, sourceUrl } from '../digest/html';

export function BatchSummary({ windowId }: { windowId?: number }) {
  const [history, setHistory] = useState<DigestOverview[]>([]);
  const [selected, setSelected] = useState('');
  const [batch, setBatch] = useState<DigestBatch>();
  const [accounts, setAccounts] = useState<PlanAccount[]>([]);
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [accountError, setAccountError] = useState('');
  async function loadAccounts() {
    setAccountError('');
    try {
      const [result, settings] = await Promise.all([
        planCall({ action: 'accounts' }),
        getSettings(),
      ]);
      const eligible = result.accounts.filter((a) => a.signedIn && a.planEnabled);
      setAccounts(eligible);
      setAccount((current) =>
        eligible.some((a) => a.id === current)
          ? current
          : eligible.find((a) => a.id === settings.chatgptPlan?.accountId)?.id ||
            (eligible.length === 1 ? eligible[0]!.id : ''),
      );
      if (!eligible.length) setAccountError('Sign in with ChatGPT in Settings to summarize tabs.');
    } catch (e) {
      setAccountError((e as Error).message);
    }
  }
  useEffect(() => {
    void loadAccounts();
  }, []);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const list = await sendDigestMessage({ action: 'list' });
        if (disposed) return;
        setHistory(list);
        const id = list.find((entry) => entry.id === selected)?.id || list[0]?.id;
        if (selected && selected !== id) setSelected(id || '');
        if (id) {
          const next = await sendDigestMessage({ action: 'get', id });
          if (!disposed) setBatch(next);
        } else setBatch(undefined);
      } catch (e) {
        if (!disposed) setError((e as Error).message);
      } finally {
        if (!disposed) timer = setTimeout(() => void refresh(), 1200);
      }
    }
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [selected]);
  async function action(kind: 'start' | 'retry' | 'stop' | 'delete') {
    setBusy(true);
    setError('');
    try {
      if (kind === 'start' || kind === 'retry') {
        const accountId = kind === 'retry' ? batch!.accountId : account;
        const catalog = await planCall({ action: 'models', accountId });
        if (
          !catalog.models.some(
            (m) =>
              m.slug === 'gpt-6-luna' &&
              m.supportedReasoningEfforts.some((e) => e.effort === 'medium'),
          )
        )
          throw new Error(
            'GPT-6 Luna with medium effort is unavailable. Refresh ChatGPT in Settings and check the native helper version.',
          );
      }
      if (kind === 'start') {
        if (windowId === undefined) throw new Error('Choose a window.');
        const next = await sendDigestMessage({
          action: 'start',
          id: crypto.randomUUID(),
          windowId,
          accountId: account,
        });
        setSelected(next.id);
        setBatch(next);
      } else if (batch) {
        if (kind === 'delete') {
          await sendDigestMessage({ action: 'delete', id: batch.id });
          setSelected('');
          setBatch(undefined);
        } else setBatch(await sendDigestMessage({ action: kind, id: batch.id }));
      }
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
    a.download = `saul-digest-${batch.id}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const active = batch?.items.some(activeItem),
    done = batch?.items.filter((i) => i.status === 'completed').length || 0;
  const needsAttention =
    batch?.items.filter((i) => ['failed', 'interrupted', 'cancelled'].includes(i.status)).length ||
    0;
  const skipped = batch?.items.filter((i) => i.status === 'skipped').length || 0;
  const firstFailure = batch?.items.find((i) => i.status === 'failed');
  const settled = batch?.items.filter((i) => !activeItem(i)).length || 0;
  return (
    <section className="panel stack" aria-label="Window summary">
      <div>
        <h3>Window digest</h3>
        <p className="small muted">Concise English → 简体中文 · Luna medium</p>
      </div>
      <p className="small muted">
        Sends loaded tab text to your ChatGPT account. You can close this panel; progress is saved.
      </p>
      {accounts.length > 1 && (
        <label className="field">
          Summary account
          <select value={account} disabled={busy} onChange={(e) => setAccount(e.target.value)}>
            <option value="">Choose account…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {accountError && (
        <p role="alert" className="notice error">
          {accountError}{' '}
          <button className="btn" onClick={() => void loadAccounts()}>
            Refresh account
          </button>
        </p>
      )}
      <button
        className="btn primary"
        disabled={busy || !account || windowId === undefined || active}
        onClick={() => void action('start')}
      >
        Summarize all tabs
      </button>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {history.length > 0 && (
        <label className="field">
          Saved digests
          <select
            value={selected || history[0]?.id || ''}
            disabled={busy}
            onChange={(e) => {
              setSelected(e.target.value);
              setBatch(undefined);
            }}
          >
            {history.map((h) => (
              <option key={h.id} value={h.id}>
                {h.windowTitle} · {new Date(h.createdAt).toLocaleString()}
              </option>
            ))}
          </select>
        </label>
      )}
      {batch && (
        <>
          <p role="status">
            {done} of {batch.items.length} summarized · {settled} processed
            {needsAttention ? ` · ${needsAttention} need attention` : ''}
            {skipped ? ` · ${skipped} skipped` : ''}
            {active ? ' · Working…' : ''}
          </p>
          <progress aria-label="Digest progress" value={settled} max={batch.items.length} />
          {firstFailure && (
            <p role="alert" className="notice error">
              {firstFailure.title}: {firstFailure.error}
            </p>
          )}
          {batch.error && (
            <p role="alert" className="notice error">
              {batch.error}
            </p>
          )}
          <div className="row">
            <button className="btn" onClick={download}>
              Download HTML
            </button>
            {active ? (
              <button className="btn" disabled={busy} onClick={() => void action('stop')}>
                Stop digest
              </button>
            ) : (
              <>
                {batch.items.some((i) =>
                  ['failed', 'interrupted', 'cancelled'].includes(i.status),
                ) && (
                  <button className="btn" disabled={busy} onClick={() => void action('retry')}>
                    Retry unfinished
                  </button>
                )}
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    if (confirm('Delete this saved digest and captured source text?'))
                      void action('delete');
                  }}
                >
                  Delete digest
                </button>
              </>
            )}
          </div>
          <details>
            <summary>Tab results and source coverage</summary>
            <ul className="digest-results">
              {batch.items.map((item) => (
                <li key={item.index}>
                  <span className="small muted">{item.status} · </span>
                  {sourceUrl(item.url) ? (
                    <a href={item.url} target="_blank" rel="noreferrer">
                      {item.title}
                    </a>
                  ) : (
                    item.title
                  )}
                  {item.summary && (
                    <>
                      <p lang="en">{item.summary.lead.en}</p>
                      <p lang="zh-Hans" className="muted">
                        {item.summary.lead.zh}
                      </p>
                    </>
                  )}
                  {item.error && (
                    <p className={item.status === 'skipped' ? 'small muted' : 'notice error'}>
                      {item.error}
                    </p>
                  )}
                  {item.coverage && <p className="small muted">{item.coverage}</p>}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
