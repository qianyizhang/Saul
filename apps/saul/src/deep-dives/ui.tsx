import { useCallback, useEffect, useState } from 'react';
import { request } from '../platform/chrome/messages';
import { useRefreshOnFocus } from '../ui/useRefreshOnFocus';
import {
  DEEP_DIVE_LABEL,
  DEEP_DIVE_RECORDS,
  DEEP_DIVE_TARGET,
  MAX_INSTRUCTION_LENGTH,
  type DeepDive,
  type DeepDiveRequest,
  type DeepDiveMessage,
  type DeepDiveResults,
} from './model';

const send = <T extends DeepDiveRequest>(message: T): Promise<DeepDiveResults[T['action']]> =>
  request({ target: DEEP_DIVE_TARGET, message } satisfies DeepDiveMessage);

const handoffText = {
  opening: 'Opening ChatGPT…',
  sending: 'Sending the prompt…',
  draft: 'Send manually in ChatGPT. Sign in or copy the prompt if needed.',
  uncertain: 'Send unconfirmed. Check ChatGPT before sending again.',
} as const;

export function DeepDiveHistory() {
  const [items, setItems] = useState<DeepDive[] | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [copied, setCopied] = useState<string>();
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useRefreshOnFocus(refresh);
  useEffect(() => {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && DEEP_DIVE_RECORDS in changes) refresh();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [refresh]);
  useEffect(() => {
    let current = true;
    void send({ action: 'list' }).then(
      ({ items: saved, error: issue }) => {
        if (current) {
          setItems(saved);
          setError(issue);
        }
      },
      (issue) => {
        if (current) setError(issue.message);
      },
    );
    return () => {
      current = false;
    };
  }, [revision]);

  async function handle(operation: () => Promise<unknown>) {
    setError('');
    try {
      await operation();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : String(issue));
    }
  }

  return (
    <section className="stack" aria-label="Saved deep dives">
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {!items && !error && (
        <p className="muted" role="status">
          Loading deep dives…
        </p>
      )}
      {items?.length === 0 && (
        <div className="empty">
          <p>No deep dives yet.</p>
          <p className="small muted">Right-click an article and choose {DEEP_DIVE_LABEL}.</p>
        </div>
      )}
      {!!items?.length && (
        <ul className="deep-dive-list">
          {items.map(({ id, title, article, prompt, handoff }) => {
            const waiting = handoff.phase === 'opening' || handoff.phase === 'sending';
            return (
              <li className="summary-entry deep-dive-entry" key={id}>
                <h3>{title}</h3>
                <div className="row wrap deep-dive-links">
                  <a href={article} target="_blank" rel="noreferrer">
                    Open article
                  </a>
                  {handoff.phase === 'sent' && (
                    <a href={handoff.url} target="_blank" rel="noreferrer">
                      Open ChatGPT chat
                    </a>
                  )}
                </div>
                {handoff.phase !== 'sent' && (
                  <p role="status" className="small muted">
                    {handoffText[handoff.phase]}
                  </p>
                )}
                {!waiting && handoff.phase !== 'sent' && (
                  <div className="row wrap">
                    <button
                      className="btn"
                      onClick={() => void handle(() => send({ action: 'open', id }))}
                    >
                      {handoff.phase === 'uncertain' ? 'Check ChatGPT' : 'Open ChatGPT'}
                    </button>
                    {handoff.phase === 'draft' && (
                      <button
                        className="btn"
                        onClick={() =>
                          void handle(async () => {
                            await navigator.clipboard.writeText(prompt);
                            setCopied(id);
                          })
                        }
                      >
                        {copied === id ? 'Copied' : 'Copy prompt'}
                      </button>
                    )}
                  </div>
                )}
                {!waiting && (
                  <details className="small">
                    <summary>Manage</summary>
                    <button
                      className="btn danger"
                      onClick={() => {
                        if (window.confirm('Remove this saved deep dive from Saul?'))
                          void handle(() => send({ action: 'remove', id }));
                      }}
                    >
                      Remove saved deep dive
                    </button>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function DeepDiveSettings({ onDirty }: { onDirty: (dirty: boolean) => void }) {
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const changed = saved !== null && draft !== saved;
  useEffect(() => {
    let current = true;
    void send({ action: 'instruction' }).then(
      (value) => {
        if (current) {
          setSaved(value);
          setDraft(value);
        }
      },
      (issue) => {
        if (current) setError(issue.message);
      },
    );
    return () => {
      current = false;
    };
  }, []);
  useEffect(() => {
    onDirty(changed);
  }, [onDirty, changed]);

  async function save() {
    if (saved === null || saving || !changed) return;
    if (!draft.trim()) {
      setError('Enter an instruction before saving.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await send({
        action: 'save-instruction',
        value: draft,
        expected: saved,
      });
      setSaved(result);
      setDraft(result);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : String(issue));
    } finally {
      setSaving(false);
    }
  }

  async function reload() {
    if (changed && !window.confirm('Replace this draft with the saved instruction?')) return;
    setSaving(true);
    try {
      const result = await send({ action: 'instruction' });
      setSaved(result);
      setDraft(result);
      setError('');
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : String(issue));
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="panel" data-deep-dive-settings>
      <summary>Deep dives</summary>
      <form
        className="stack"
        aria-label="Deep dive settings"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="field">
          Deep dive instruction
          <textarea
            name="instruction"
            rows={4}
            required
            value={draft}
            maxLength={MAX_INSTRUCTION_LENGTH}
            disabled={saving || saved === null}
            aria-describedby="deep-dive-instruction-help"
            onChange={(event) => {
              setDraft(event.target.value);
              setError('');
            }}
          />
        </label>
        <p id="deep-dive-instruction-help" className="small muted">
          {DEEP_DIVE_LABEL} sends this instruction and the article URL to ChatGPT in this Chrome
          profile.
        </p>
        {error && (
          <p className="notice error" role="alert">
            {error}{' '}
            <button className="btn" type="button" disabled={saving} onClick={() => void reload()}>
              Reload saved instruction
            </button>
          </p>
        )}
        <div className="row wrap">
          <button type="submit" className="btn primary" disabled={!changed || saving}>
            {saving ? 'Saving…' : 'Save instruction'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!changed || saving}
            onClick={() => {
              if (saved !== null) setDraft(saved);
              setError('');
            }}
          >
            Discard changes
          </button>
        </div>
      </form>
    </details>
  );
}
