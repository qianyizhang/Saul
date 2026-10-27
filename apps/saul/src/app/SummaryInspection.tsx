import { useState } from 'react';
import type { DigestBatch, DigestComparison, DigestInspection, DigestItem } from '../digest/types';
import { sendDigestMessage } from '../storage/client';
import { InspectionText } from '../surface/InspectionText';
import { changeLabel } from '../reading/input-change';
import { SUMMARY_PROMPT, summaryUserPrompt } from '../digest/summary';

export function ComparisonNote({ comparison }: { comparison: DigestComparison }) {
  return (
    <div className="small muted">
      <p>
        {comparison.error
          ? `Current input not verified: ${comparison.error}`
          : comparison.text
            ? changeLabel(comparison.text)
            : 'Source comparison unavailable'}
      </p>
      {comparison.fields.length > 0 && <p>Also changed: {comparison.fields.join(', ')}</p>}
    </div>
  );
}
export function SummaryInspection({
  batch,
  item,
  tabId,
}: {
  batch: DigestBatch;
  item: DigestItem;
  tabId?: number;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<DigestInspection>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<'saved' | 'current'>('saved');
  async function load(compare = false) {
    setBusy(true);
    setError('');
    try {
      const result = await sendDigestMessage({
        action: 'inspect',
        id: batch.id,
        index: item.index,
        ...(compare && tabId !== undefined ? { tabId } : {}),
      });
      setValue(result);
      if (!result.current) setView('saved');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const source = view === 'saved' ? value?.saved : value?.current;
  return (
    <details
      className="saul-inspector"
      onToggle={(event) => {
        const next = event.currentTarget.open;
        setOpen(next);
        if (next && !value && !busy) void load();
      }}
    >
      <summary>Inspect input/output</summary>
      {open && (
        <div className="saul-inspection-content">
          <p className="saul-inspection-note">
            {item.status} · {new Date(batch.createdAt).toLocaleString()}
          </p>
          <p className="saul-inspection-note">
            Saved generation input. Current page text is read only when you choose Compare. No model
            request.
          </p>
          {error && <p role="alert">{error}</p>}
          {busy && <p role="status">Reading input…</p>}
          {tabId !== undefined && (
            <button className="btn" disabled={busy} onClick={() => void load(true)}>
              Compare current page
            </button>
          )}
          {value?.comparison && (
            <>
              <ComparisonNote comparison={value.comparison} />
              <p className="saul-inspection-note">
                Token counts estimate additions/removals, not meaning or edit distance. Token
                inventories do not quantify reordering. Changes outside the capture cannot be
                measured.
              </p>
            </>
          )}
          {value?.current && (
            <div className="saul-inspection-pages" aria-label="Input version">
              <button
                type="button"
                aria-pressed={view === 'saved'}
                onClick={() => setView('saved')}
              >
                Saved input
              </button>
              <button
                type="button"
                aria-pressed={view === 'current'}
                onClick={() => setView('current')}
              >
                Current input
              </button>
            </div>
          )}
          {source ? (
            <>
              <dl className="saul-metadata">
                <div>
                  <dt>Page title</dt>
                  <dd>{view === 'saved' ? item.title : source.title || 'Not recorded'}</dd>
                </div>
                <div>
                  <dt>Page URL</dt>
                  <dd>{item.url}</dd>
                </div>
                <div>
                  <dt>Captured</dt>
                  <dd>{new Date(source.capturedAt).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Characters</dt>
                  <dd>
                    {source.text.length.toLocaleString()}
                    {source.truncated ? ' · truncated' : ''}
                  </dd>
                </div>
                <div>
                  <dt>Coverage</dt>
                  <dd>{source.coverage}</dd>
                </div>
              </dl>
              <InspectionText
                key={view}
                label={view === 'saved' ? 'Captured page text' : 'Current page text'}
                text={source.text}
              />
            </>
          ) : (
            !busy && (
              <p className="saul-inspection-note">No source text recorded for this attempt.</p>
            )
          )}
          <details>
            <summary>Saved instructions</summary>
            <InspectionText label="Instructions" text={batch.prompt} />
          </details>
          {value?.comparison?.fields.includes('Instructions') && (
            <details>
              <summary>Current summary instructions</summary>
              <InspectionText label="Current instructions" text={SUMMARY_PROMPT} />
            </details>
          )}
          <details>
            <summary>Saved request and response</summary>
            <p className="saul-inspection-note">
              The saved prompt is the exact user message. It includes the original page title, URL,
              coverage and text. Saved input describes what was prepared; only completed output
              confirms completion.
            </p>
            {value?.saved && (
              <InspectionText label="Prompt · user" text={summaryUserPrompt(item, value.saved)} />
            )}
            <InspectionText label="Response · raw text" text={item.raw} response />
          </details>
        </div>
      )}
    </details>
  );
}
