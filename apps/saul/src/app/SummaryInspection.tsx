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
            : comparison.notice || 'Source comparison unavailable'}
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
            Saved generation input. Compare checks the current source without a model request.
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
              {value.comparison.text && (
                <p className="saul-inspection-note">
                  Token counts estimate additions/removals, not meaning or edit distance. Token
                  inventories do not quantify reordering. Changes outside the capture cannot be
                  measured.
                </p>
              )}
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
                  <dt>{source.kind === 'pdf-url' ? 'Prepared' : 'Captured'}</dt>
                  <dd>{new Date(source.capturedAt).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>{source.kind === 'pdf-url' ? 'Input type' : 'Characters'}</dt>
                  <dd>
                    {source.kind === 'pdf-url' ? (
                      'PDF URL attachment'
                    ) : (
                      <>
                        {source.text.length.toLocaleString()}
                        {source.truncated ? ' · truncated' : ''}
                      </>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Coverage</dt>
                  <dd>{source.coverage}</dd>
                </div>
              </dl>
              {source.kind === 'pdf-url' ? (
                <>
                  <a href={source.attachment.url} target="_blank" rel="noreferrer">
                    Open PDF URL
                  </a>
                  <InspectionText
                    key={view}
                    label="PDF URL attachment"
                    text={JSON.stringify(
                      { type: 'input_file', file_url: source.attachment.url },
                      null,
                      2,
                    )}
                  />
                </>
              ) : (
                <InspectionText
                  key={view}
                  label={view === 'saved' ? 'Captured page text' : 'Current page text'}
                  text={source.text}
                />
              )}
            </>
          ) : (
            !busy && (
              <p className="saul-inspection-note">No source input recorded for this attempt.</p>
            )
          )}
          <details>
            <summary>Saved instructions</summary>
            <InspectionText label="Instructions" text={batch.prompt} />
            {batch.action && (
              <p className="small muted">
                {batch.action.revision.name} · contract 1 · revision{' '}
                {batch.action.revision.revision} · {batch.action.input?.preset?.name}
              </p>
            )}
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
              {value?.saved?.kind === 'pdf-url'
                ? "The saved prompt is the exact text message. PDF URL attachments are listed separately; the provider's extracted text is not returned."
                : 'The saved prompt is the exact user message. It includes the original page title, URL, coverage and text.'}{' '}
              Saved input describes what was prepared; only completed output confirms completion.
            </p>
            {value?.saved && !batch.action && (
              <InspectionText label="Prompt · user" text={summaryUserPrompt(item, value.saved)} />
            )}
            {value?.saved?.kind === 'pdf-url' && (
              <InspectionText
                label="Saved file input"
                text={JSON.stringify(
                  { type: 'input_file', file_url: value.saved.attachment.url },
                  null,
                  2,
                )}
              />
            )}
            <InspectionText label="Response · raw text" text={item.raw} response />
            {item.calls?.map((call, index) => (
              <details key={index}>
                <summary>
                  Model call {index + 1} ·{' '}
                  {call.complete ? 'complete response' : 'incomplete response'}
                </summary>
                <InspectionText label="Call instructions" text={call.instructions} />
                <InspectionText label="Call input" text={call.input} />
                <InspectionText
                  label="Intermediate output · not the final answer"
                  text={call.output}
                  response
                />
              </details>
            ))}
            {batch.action && (
              <InspectionText
                label={
                  item.status === 'completed' ? 'Final action result' : 'No completed action result'
                }
                text={item.status === 'completed' ? item.finalText || '' : ''}
                response
              />
            )}
          </details>
        </div>
      )}
    </details>
  );
}
