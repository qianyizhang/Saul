import { activeAnnotationAttempt, type AnnotationAttempt } from './attempts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { annotationMessage, annotations, attempts } from './client';
import { annotationPanelKey, annotationVersionKey } from './routing';
import type { Annotation, AnnotationChange, AnnotationSummary } from './contract';
import type { ModelPreset } from '../configuration/definition';
import type { CallChoice } from '../calls/contract';
import './panel.css';

export function AnnotationPanel({ windowId }: { windowId: number }) {
  const [page, setPage] = useState<{ url: string; title: string; tabId: number }>();
  const [records, setRecords] = useState<AnnotationSummary[]>([]),
    [selected, setSelected] = useState<string>();
  const [filter, setFilter] = useState<'open' | 'done' | 'deleted' | 'all'>('open'),
    [checked, setChecked] = useState<string[]>([]);
  const [error, setError] = useState(''),
    [choices, setChoices] = useState<{ presets: ModelPreset[]; calls: CallChoice[] }>({
      presets: [],
      calls: [],
    });
  const [preset, setPreset] = useState(''),
    [call, setCall] = useState(''),
    [textOnly, setTextOnly] = useState(false),
    [current, setCurrent] = useState(false),
    [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const generation = ++sequence.current;
    try {
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      if (generation !== sequence.current) return;
      if (!tab?.id || tab.incognito || !/^https?:/.test(tab.url ?? '')) {
        setPage(undefined);
        setRecords([]);
        return;
      }
      const url = tab.url!;
      const all: AnnotationSummary[] = [];
      let offset = 0;
      do {
        const result = await annotations(url, { action: 'list', url, filter, offset });
        all.push(...(result.records ?? []));
        offset = result.nextOffset ?? -1;
      } while (offset >= 0);
      if (generation !== sequence.current) return;
      setPage((before) => {
        if (before?.url !== url) {
          setSelected(undefined);
          setChecked([]);
        }
        return { url, title: tab.title ?? url, tabId: tab.id! };
      });
      setRecords(all);
      setSelected((id) => (all.some((a) => a.id === id) ? id : undefined));
      setChecked((ids) => ids.filter((id) => all.some((a) => a.id === id)));
      const route = (await chrome.storage.session.get(annotationPanelKey(windowId)))[
        annotationPanelKey(windowId)
      ];
      if (generation !== sequence.current) return;
      if (
        route &&
        typeof route === 'object' &&
        'id' in route &&
        typeof route.id === 'string' &&
        all.some((a) => a.id === route.id)
      ) {
        setSelected(route.id);
        await chrome.storage.session.set({
          [annotationPanelKey(windowId)]: { view: 'annotations' },
        });
      }
    } catch (e) {
      if (generation === sequence.current) setError((e as Error).message);
    }
  }, [filter, windowId]);
  useEffect(() => {
    void refresh();
    const changed = (_id: number, change: chrome.tabs.OnUpdatedInfo) => {
      if (change.url || change.status === 'complete') void refresh();
    };
    const activated = () => void refresh();
    const stored = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes[annotationVersionKey] || changes[annotationPanelKey(windowId)]) void refresh();
    };
    chrome.tabs.onActivated.addListener(activated);
    chrome.tabs.onUpdated.addListener(changed);
    chrome.storage.onChanged.addListener(stored);
    return () => {
      sequence.current++;
      chrome.tabs.onActivated.removeListener(activated);
      chrome.tabs.onUpdated.removeListener(changed);
      chrome.storage.onChanged.removeListener(stored);
    };
  }, [refresh, windowId]);
  useEffect(() => {
    void annotationMessage({ action: 'choices' }).then(setChoices, (e) => setError(String(e)));
  }, []);
  const targets = checked.length
    ? records.filter((a) => checked.includes(a.id))
    : records.filter((a) => a.state === 'open' && a.comment.trim() && !a.deletedAt);
  return (
    <section className="annotations stack" aria-label="Page annotations">
      <header>
        <h1>Annotations</h1>
        <p className="small">{page?.title ?? 'Choose an ordinary web page.'}</p>
      </header>
      <div className="row">
        <button
          className="btn primary"
          onClick={() =>
            void annotationMessage({ action: 'start-capture' }).catch((e) => setError(String(e)))
          }
        >
          Annotate
        </button>
        <button className="btn" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <label>
        Show
        <select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as typeof filter);
            setChecked([]);
            setSelected(undefined);
          }}
        >
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
            <input
              type="checkbox"
              aria-label={`Select annotation ${a.number}`}
              checked={checked.includes(a.id)}
              onChange={(e) =>
                setChecked((ids) =>
                  e.target.checked ? [...ids, a.id] : ids.filter((id) => id !== a.id),
                )
              }
            />
            <button
              className="annotation-item"
              aria-pressed={selected === a.id}
              onClick={() => setSelected(a.id)}
            >
              <strong>
                {a.number}. {a.target.label || 'Captured target'}
              </strong>
              <span>{a.comment || 'Add a comment…'}</span>
              <small>
                {a.state === 'done' ? 'Done' : 'Open'} · {a.replyCount} replies
              </small>
            </button>
          </li>
        ))}
      </ul>
      {page && selected && (
        <AnnotationEditor
          key={selected}
          id={selected}
          url={page.url}
          tabId={page.tabId}
          updated={() => void refresh()}
        />
      )}
      {filter !== 'deleted' && page && (
        <details>
          <summary>Respond to annotations · {targets.length}</summary>
          <div className="stack">
            <p>
              {checked.length ? 'Selected annotations' : 'All open annotations with comments'}.{' '}
              {targets.filter((a) => a.hasImage).length} screenshots.
            </p>
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
              disabled={busy || !preset || !targets.length}
              onClick={() => {
                setBusy(true);
                setError('');
                void annotationMessage({
                  action: 'respond',
                  options: {
                    url: page.url,
                    ids: targets.map((a) => a.id),
                    presetId: preset,
                    textOnly,
                    current,
                    ...(call ? { callRevision: call } : {}),
                  },
                })
                  .then(
                    () => {
                      setSelected(targets[0]?.id);
                    },
                    (e) => setError(String(e)),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Run · {targets.length}
            </button>
          </div>
        </details>
      )}
    </section>
  );
}
type CommentDraft =
  | { phase: 'loading' | 'saved' | 'saving'; text: string }
  | { phase: 'blocked'; text: string; error: string };

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
  const [record, setRecord] = useState<Annotation>(),
    [draft, showDraft] = useState<CommentDraft>({ phase: 'loading', text: '' }),
    [reply, setReply] = useState(''),
    [error, setError] = useState(''),
    [located, setLocated] = useState<string>(),
    [runs, setRuns] = useState<AnnotationAttempt[]>([]),
    [inspect, setInspect] = useState<AnnotationAttempt>();
  const currentDraft = useRef(draft);
  const baseRevision = useRef<number | undefined>(undefined);
  const edits = useRef(Promise.resolve());
  const localWrites = useRef(Promise.resolve());
  const readVersion = useRef(0);
  const mounted = useRef(false);
  const draftKey = 'saul-annotation-draft-' + id;
  const publishDraft = useCallback((next: CommentDraft) => {
    currentDraft.current = next;
    if (mounted.current) showDraft(next);
  }, []);
  const load = useCallback(async () => {
    const version = ++readVersion.current;
    const { record: saved } = await annotations(url, { action: 'read', id, image: true });
    if (!mounted.current || version !== readVersion.current || !saved) return;
    setRecord(saved);
    if (currentDraft.current.phase === 'saved') {
      baseRevision.current = saved.revision;
      publishDraft({ phase: 'saved', text: saved.comment });
    }
    const history = await attempts(id);
    if (mounted.current && version === readVersion.current) setRuns(history);
    return saved;
  }, [id, url, publishDraft]);
  useEffect(() => {
    mounted.current = true;
    const read = () =>
      void load().catch((e) => {
        if (mounted.current) setError(String(e));
      });
    void (async () => {
      const recovered = (await chrome.storage.local.get(draftKey))[draftKey];
      const saved = await load();
      if (!saved || !mounted.current || currentDraft.current.phase !== 'loading') return;
      baseRevision.current = saved.revision;
      if (
        recovered &&
        typeof recovered === 'object' &&
        'text' in recovered &&
        typeof recovered.text === 'string'
      )
        publishDraft({
          phase: 'blocked',
          text: recovered.text,
          error: 'An unsaved draft was restored. Review the current comment before saving it.',
        });
      else publishDraft({ phase: 'saved', text: saved.comment });
    })().catch((e) => {
      if (mounted.current) setError(String(e));
    });
    const changed = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes[annotationVersionKey] && currentDraft.current.phase !== 'loading') read();
    };
    chrome.storage.onChanged.addListener(changed);
    return () => {
      mounted.current = false;
      readVersion.current++;
      chrome.storage.onChanged.removeListener(changed);
    };
  }, [load, draftKey, publishDraft]);
  useEffect(() => {
    if (!runs.some(activeAnnotationAttempt)) return;
    const timer = setInterval(() => void load().catch((e) => setError(String(e))), 1000);
    return () => clearInterval(timer);
  }, [runs, load]);
  const change = async (action: AnnotationChange['action'], text?: string) => {
    const revision = baseRevision.current;
    if (revision === undefined) throw new Error('Annotation is still loading.');
    const result = await annotations(url, {
      action: 'change',
      changes: [
        {
          id,
          revision,
          operationId: crypto.randomUUID(),
          action,
          ...(text !== undefined ? { text } : {}),
        },
      ],
    });
    const outcome = result.outcomes?.[0];
    if (outcome?.error) throw new Error(outcome.error);
    if (action === 'purge') return;
    if (!outcome?.record) throw new Error('Annotation save was not confirmed.');
    // Advance the edit lane to the revision this write accepted, never to a
    // newer revision read while an unsaved local edit remains.
    baseRevision.current = outcome.record.revision;
    return load().catch((e) => {
      if (mounted.current) setError(String(e));
    });
  };
  const enqueue = (work: () => Promise<void>) => {
    edits.current = edits.current.then(work).catch((e) => {
      if (mounted.current) setError(String(e));
    });
  };
  const save = (text: string, review = false) => {
    const before = currentDraft.current;
    if (review && record) baseRevision.current = record.revision;
    const next: CommentDraft =
      before.phase === 'blocked' && !review ? { ...before, text } : { phase: 'saving', text };
    publishDraft(next);
    const persist = localWrites.current
      .catch(() => undefined)
      .then(() => chrome.storage.local.set({ [draftKey]: { text } }));
    localWrites.current = persist;
    void persist.catch(() => undefined);
    enqueue(async () => {
      try {
        await persist;
        if (next.phase === 'blocked' || currentDraft.current.phase === 'blocked') return;
        const fresh = await change('edit', text);
        if (currentDraft.current !== next) return;
        const clear = localWrites.current.then(async () => {
          if (currentDraft.current === next) await chrome.storage.local.remove(draftKey);
        });
        localWrites.current = clear;
        await clear;
        if (currentDraft.current === next) {
          if (fresh) baseRevision.current = fresh.revision;
          publishDraft({ phase: 'saved', text: fresh?.comment ?? text });
        }
      } catch (cause) {
        // Whether this save or a newer queued edit was active, retain its text
        // and stop sending edits until the author explicitly reviews the base.
        publishDraft({
          phase: 'blocked',
          text: currentDraft.current.text,
          error: String(cause),
        });
        await load().catch(() => undefined);
      }
    });
  };
  const act = (action: AnnotationChange['action'], text?: string) => {
    enqueue(async () => {
      if (currentDraft.current.phase === 'blocked' && action !== 'purge') return;
      await change(action, text);
      if (action === 'purge') {
        await localWrites.current.catch(() => undefined);
        await chrome.storage.local.remove(draftKey);
      }
      if (mounted.current) {
        setReply('');
        setError('');
      }
      updated();
    });
  };
  const status = {
    loading: 'Loading…',
    saved: 'Saved',
    saving: 'Saving…',
    blocked: 'Unsaved',
  }[draft.phase];
  if (!record || draft.phase === 'loading') return <p role="status">{error || status}</p>;
  return (
    <article className="stack annotation-editor" aria-label="Annotation editor">
      <h2>Annotation {record.number}</h2>
      {record.image ? (
        <figure>
          <img
            src={record.image}
            alt={`Captured viewport with annotation ${record.number} outlined`}
          />
          <figcaption>Saved viewport · {new Date(record.createdAt).toLocaleString()}</figcaption>
        </figure>
      ) : (
        <p>{record.imageError || 'No image saved.'}</p>
      )}
      <details>
        <summary>Page evidence</summary>
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
            .sendMessage(tabId, { type: 'SAUL_ANNOTATION_LOCATE', annotation: record })
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
          {error && <p role="alert">{error}</p>}
          {draft.phase === 'blocked' && (
            <div role="alert">
              <p>{draft.error}</p>
              <p>Latest saved comment: {record.comment}</p>
              <button className="btn" onClick={() => save(draft.text, true)}>
                Save draft against latest
              </button>
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
            {record.image && (
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
      {record.deletedAt !== undefined && error && <p role="alert">{error}</p>}
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
            act('append', reply);
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
          <button className="btn" disabled={!reply.trim()}>
            Append reply
          </button>
        </form>
      )}
      {runs.map((r) => (
        <div className="stack" key={r.id}>
          <p>
            {r.status} · {r.input.preset?.name}
          </p>
          {r.error && <p role="alert">{r.error}</p>}
          <button
            className="btn"
            onClick={() =>
              void annotationMessage({ action: 'inspect', id: r.id }).then(
                (v) => setInspect(v[0]),
                (e) => setError(String(e)),
              )
            }
          >
            Inspect input/output
          </button>
          {(r.status === 'queued' || r.status === 'running') && (
            <button
              className="btn"
              onClick={() =>
                void annotationMessage({ action: 'stop', id: r.id })
                  .then(() => load())
                  .catch((e) => setError(String(e)))
              }
            >
              Stop
            </button>
          )}
        </div>
      ))}
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
