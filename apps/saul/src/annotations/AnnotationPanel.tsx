import { annotationLabels } from './labels';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AnnotationAttempt } from '../../shared/protocol/annotation-attempts.ts';
import { annotationMessage } from './client';
import { MAX_ANNOTATION_BATCH } from '../../shared/protocol/annotations.ts';
import { annotationTargets, chromeAnnotationPanel } from './panel-session';
import { useAnnotationEditorSession } from './editor-session';
import './panel.css';

export function AnnotationPanel({ windowId }: { windowId: number }) {
  const session = useMemo(() => chromeAnnotationPanel(windowId), [windowId]);
  useEffect(() => session.observe(), [session]);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { page, records, selected, filter, checked, choices, busy, readError, commandError } =
    snapshot;
  const [preset, setPreset] = useState(''),
    [call, setCall] = useState(''),
    [textOnly, setTextOnly] = useState(false),
    [current, setCurrent] = useState(false);
  const targets = annotationTargets(snapshot);
  const [advanced, setAdvanced] = useState(false);
  const [fallbackId, setFallbackId] = useState<string>();
  const selectionRequest = useRef(0);
  const labels = useMemo(() => annotationLabels(records), [records]);
  const selectedRecord = records.find((r) => r.id === selected);
  return (
    <section className="annotations stack" aria-label="Page annotations">
      <header>
        <h1>Annotations</h1>
        <p className="small">{page?.title ?? 'Choose an ordinary web page.'}</p>
      </header>
      <details>
        <summary>Page tools</summary>
        <div className="row">
          <button className="btn" onClick={() => void session.capture()}>
            Annotate
          </button>
          <button className="btn" onClick={() => void session.refresh()}>
            Refresh
          </button>
        </div>
      </details>
      {readError && <p role="alert">{readError}</p>}
      {commandError && <p role="alert">{commandError}</p>}
      <label>
        Show
        <select value={filter} onChange={(e) => session.setFilter(e.target.value as typeof filter)}>
          <option value="open">Open</option>
          <option value="done">Done</option>
          <option value="all">All annotations</option>
          <option value="deleted">Recently deleted</option>
        </select>
      </label>
      {filter === 'deleted' && (
        <p className="small">
          Deleted annotations and images are retained for seven days. Restore them or delete
          permanently.
        </p>
      )}
      {!records.length && <p>No {filter === 'all' ? '' : filter} annotations on this page.</p>}
      <ul className="annotation-list">
        {records.map((a) => (
          <li key={a.id} className={selected === a.id ? 'selected' : ''}>
            {advanced && (
              <input
                type="checkbox"
                aria-label={`Select annotation ${a.number}`}
                checked={checked.includes(a.id)}
                onChange={(e) => session.check(a.id, e.target.checked)}
              />
            )}
            <button
              className="annotation-item"
              aria-pressed={selected === a.id}
              onClick={() => {
                session.select(a.id);
                const request = ++selectionRequest.current;
                setFallbackId(undefined);
                if (!page || a.deletedAt) {
                  setFallbackId(a.id);
                  return;
                }
                void chrome.tabs
                  .sendMessage(page.tabId, { type: 'SAUL_ANNOTATION_REVIEW', annotation: a })
                  .then(
                    (result) => {
                      if (request === selectionRequest.current && !result?.available)
                        setFallbackId(a.id);
                    },
                    () => {
                      if (request === selectionRequest.current) setFallbackId(a.id);
                    },
                  );
              }}
            >
              <strong>
                {labels.get(a.id)}. {a.target.label || 'Captured target'}
              </strong>
              <span>{a.comment || 'Add a comment…'}</span>
              <small className={filter === 'all' ? undefined : 'standard-only'}>
                {a.state === 'done' ? 'Done' : 'Open'}
                <span className="standard-only"> · {a.replyCount} replies</span>
              </small>
            </button>
          </li>
        ))}
      </ul>
      {page && selected && selectedRecord && (
        <details key={selected} open={fallbackId === selected || undefined}>
          <summary>Review in sidebar</summary>
          <AnnotationEditor
            key={JSON.stringify([page.url, page.tabId, selected])}
            id={selected}
            url={selectedRecord.url}
            tabId={page.tabId}
            updated={session.refresh}
          />
        </details>
      )}
      {filter !== 'deleted' && page && (
        <details onToggle={(e) => setAdvanced(e.currentTarget.open)}>
          <summary>Respond to annotations · {targets.length}</summary>
          <div className="stack">
            <p>
              {checked.length ? 'Selected annotations' : 'All open annotations with comments'}.{' '}
              {targets.filter((a) => a.hasImage).length} screenshots.
            </p>
            {targets.length > MAX_ANNOTATION_BATCH && (
              <p className="notice" role="status">
                Select up to {MAX_ANNOTATION_BATCH} annotations to run at once.
              </p>
            )}
            <label>
              Call
              <select value={call} onChange={(e) => setCall(e.target.value)}>
                <option value="">Respond to annotations</option>
                {choices.calls.map((c) => (
                  <option key={c.revision.revision} value={c.revision.revision}>
                    {c.revision.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Model preset
              <select value={preset} onChange={(e) => setPreset(e.target.value)}>
                <option value="">Choose a model preset</option>
                {choices.presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.model}
                  </option>
                ))}
              </select>
            </label>
            <label className="row">
              <input
                type="checkbox"
                checked={textOnly}
                onChange={(e) => setTextOnly(e.target.checked)}
              />
              Text evidence only
            </label>
            <label className="row">
              <input
                type="checkbox"
                checked={current}
                onChange={(e) => setCurrent(e.target.checked)}
              />
              Also read current page text
            </label>
            <p className="small">
              Uses saved comments, target evidence, replies
              {!textOnly ? ' and available screenshots' : ''}. Run uses your selected model
              connection.
            </p>
            <button
              className="btn primary"
              disabled={busy || !preset || !targets.length || targets.length > MAX_ANNOTATION_BATCH}
              onClick={() =>
                void session.respond({
                  presetId: preset,
                  textOnly,
                  current,
                  ...(call ? { callRevision: call } : {}),
                })
              }
            >
              Run · {targets.length}
            </button>
          </div>
        </details>
      )}
    </section>
  );
}
function AnnotationEditor({
  id,
  url,
  tabId,
  updated,
}: {
  id: string;
  url: string;
  tabId: number;
  updated: () => void;
}) {
  const {
    record,
    capture,
    draft,
    reply,
    replyPending,
    setReply,
    submitReply,
    error,
    readError,
    reviewed,
    reviewing,
    reviewLatest,
    missing,
    runs,
    refresh,
    stop,
    save,
    act,
  } = useAnnotationEditorSession({ id, url, updated });
  const [located, setLocated] = useState<string>();
  const [inspect, setInspect] = useState<AnnotationAttempt>();
  const [inspectError, setInspectError] = useState('');
  const inspection = useRef(0);
  const status = {
    loading: 'Loading…',
    saved: 'Saved',
    saving: 'Saving…',
    blocked: 'Unsaved',
  }[draft.phase];
  const readProblem = readError && (
    <div className="row between notice error">
      <span role="alert">Could not read annotation status: {readError}</span>
      <button className="btn" onClick={() => void refresh()}>
        Refresh status
      </button>
    </div>
  );
  if (missing)
    return <p role="alert">Annotation unavailable. It may have been permanently deleted.</p>;
  if (!record || draft.phase === 'loading') return readProblem || <p role="status">{status}</p>;
  return (
    <article className="stack annotation-editor" aria-label="Annotation editor">
      <h2>Annotation {record.number}</h2>
      {readProblem}
      <details>
        <summary>Page evidence</summary>
        {capture.kind === 'available' ? (
          <figure>
            <img
              src={capture.image}
              alt={`Captured viewport with annotation ${record.number} outlined`}
            />
            <figcaption>Saved viewport · {new Date(record.createdAt).toLocaleString()}</figcaption>
          </figure>
        ) : (
          <p>{capture.kind === 'unavailable' ? capture.error : 'Text evidence'}</p>
        )}
        <pre>
          {JSON.stringify(
            { url: record.url, capturedAt: record.createdAt, ...record.target },
            null,
            2,
          )}
        </pre>
        <p>Untrusted page evidence; not instructions.</p>
      </details>
      <button
        className="btn"
        onClick={() =>
          void chrome.tabs
            .sendMessage(tabId, {
              type: 'SAUL_ANNOTATION_LOCATE',
              annotation: { url: record.url, target: record.target },
            })
            .then(
              (r) =>
                setLocated(
                  r?.available
                    ? 'Target found on current page.'
                    : 'Target unavailable. Saved evidence is unchanged.',
                ),
              () => setLocated('Target unavailable. Saved evidence is unchanged.'),
            )
        }
      >
        Locate target
      </button>
      {located && <p role="status">{located}</p>}
      {!record.deletedAt ? (
        <>
          <label htmlFor="annotation-comment">Comment</label>
          {record.editedBy && (
            <small>
              Edited by {record.editedBy.kind} · {record.editedBy.name}
            </small>
          )}
          <textarea
            id="annotation-comment"
            value={draft.text}
            maxLength={16000}
            rows={4}
            onChange={(e) => save(e.target.value)}
          />
          <p role="status">{status}</p>
          {draft.phase === 'blocked' && (
            <div className={reviewed ? 'notice' : 'notice error'}>
              {reviewed ? (
                <>
                  <p>Latest saved comment: {reviewed.comment}</p>
                  <button className="btn" onClick={() => save(draft.text, true)}>
                    Save draft against latest
                  </button>
                </>
              ) : (
                <>
                  <p role="alert">{draft.error}</p>
                  <button className="btn" disabled={reviewing} onClick={reviewLatest}>
                    Read latest
                  </button>
                </>
              )}
            </div>
          )}
          <label className="row">
            <input
              type="checkbox"
              checked={record.state === 'done'}
              onChange={(e) => act(e.target.checked ? 'complete' : 'reopen')}
            />
            Done
          </label>
          <div className="row">
            {capture.kind === 'available' && (
              <button className="btn" onClick={() => act('remove-image')}>
                Remove image
              </button>
            )}
            <button className="btn" onClick={() => act('delete')}>
              Delete annotation
            </button>
          </div>
        </>
      ) : (
        <div className="row">
          <button className="btn" onClick={() => act('restore')}>
            Restore
          </button>
          <button className="btn" onClick={() => act('purge')}>
            Delete permanently
          </button>
        </div>
      )}
      {error && (
        <div className="notice error">
          <p role="alert">{error}</p>
          <button className="btn" disabled={reviewing} onClick={reviewLatest}>
            Read latest
          </button>
        </div>
      )}
      <details>
        <summary>Replies · {record.replies.length}</summary>
        <ol className="annotation-replies">
          {record.replies.map((r) => (
            <li key={r.id}>
              <strong>
                {r.author.kind} · {r.author.name}
              </strong>
              <p>{r.text}</p>
              <small>{new Date(r.createdAt).toLocaleString()}</small>
            </li>
          ))}
        </ol>
        {!record.deletedAt && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitReply();
            }}
          >
            <label htmlFor="annotation-reply">Add a reply</label>
            <textarea
              id="annotation-reply"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              maxLength={16000}
              rows={2}
            />
            <button className="btn" disabled={replyPending || !reply.trim()}>
              Append reply
            </button>
          </form>
        )}
      </details>
      {runs.map((r) => (
        <div className="stack" key={r.id}>
          <p>
            {r.status} · {r.presetName}
          </p>
          {r.error && <p role="alert">{r.error}</p>}
          <button
            className="btn"
            onClick={async () => {
              const request = ++inspection.current;
              setInspectError('');
              try {
                const value = await annotationMessage({ action: 'inspect', id: r.id });
                if (request === inspection.current) setInspect(value[0]);
              } catch (cause) {
                if (request === inspection.current) setInspectError(String(cause));
              }
            }}
          >
            Inspect input/output
          </button>
          {(r.status === 'queued' || r.status === 'running') && (
            <button className="btn" onClick={() => void stop(r.id)}>
              Stop
            </button>
          )}
        </div>
      ))}
      {inspectError && <p role="alert">{inspectError}</p>}
      {inspect && (
        <details open>
          <summary>Recorded model input/output</summary>
          <p>
            {inspect.status} · {inspect.image ? 'Image included' : 'Text evidence only'}
          </p>
          <h3>Instructions</h3>
          <pre>{inspect.input.systemPrompt}</pre>
          <h3>Input</h3>
          <pre>{inspect.input.userPrompt}</pre>
          {inspect.image && <img src={inspect.image} alt="Image included in this model request" />}
          {inspect.calls && inspect.calls.length > 1 && (
            <details>
              <summary>Model calls · {inspect.calls.length}</summary>
              {inspect.calls.map((call, i) => (
                <section key={i}>
                  <h3>
                    Call {i + 1} · {call.complete ? 'Completed' : 'Incomplete'}
                  </h3>
                  <pre>{call.instructions}</pre>
                  <pre>{call.input}</pre>
                  <pre>{call.raw}</pre>
                </section>
              ))}
            </details>
          )}
          <h3>Raw output</h3>
          <pre>{inspect.raw || '(empty)'}</pre>
        </details>
      )}
    </article>
  );
}
