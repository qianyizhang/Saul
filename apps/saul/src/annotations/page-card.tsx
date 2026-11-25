import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { annotationMessage } from './client';
import { annotationMutationSession } from './mutation-session';
import type {
  Annotation,
  AnnotationCapture,
  AnnotationChange,
} from '../../shared/protocol/annotations.ts';
import tokens from '../../assets/design-tokens.css?inline';
import styles from './page-card.css?inline';

type Card = {
  capture: AnnotationCapture;
  existing?: boolean;
  editOnOpen?: boolean;
  saved?: () => void;
  rect: () => DOMRect | undefined;
  locate: () => void;
};
type Draft = { id: string; mode: 'edit' | 'reply'; text: string; revision?: number };
const drafts = new Map<string, Draft>();
const pendingChanges = new Map<string, AnnotationChange>();
function draftKey(card: Card) {
  const { url, target, id } = card.capture;
  return card.existing
    ? id
    : JSON.stringify([
        url,
        target.kind,
        target.selector,
        target.text,
        target.quoteContext,
        target.label,
      ]);
}
let current: { close: () => void; busy: () => boolean } | undefined;
export function dismissAnnotationCard() {
  current?.close();
}
export function openAnnotationCard(card: Card) {
  if (current?.busy()) return;
  dismissAnnotationCard();
  const draft = drafts.get(draftKey(card));
  if (draft && !card.existing) card.capture.id = draft.id;
  const host = document.createElement('saul-annotation-card');
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = tokens + styles;
  const container = document.createElement('div');
  shadow.append(style, container);
  document.documentElement.append(host);
  const root = createRoot(container);
  let pending = false;
  const previous = document.activeElement;
  let disposed = false;
  const close = () => {
    if (disposed) return;
    disposed = true;
    removeEventListener('popstate', close);
    removeEventListener('hashchange', close);
    root.unmount();
    host.remove();
    current = undefined;
    if (previous instanceof HTMLElement && previous.isConnected)
      previous.focus({ preventScroll: true });
  };
  current = { close, busy: () => pending };
  addEventListener('popstate', close);
  addEventListener('hashchange', close);
  root.render(
    <CommentCard
      card={card}
      close={close}
      pending={(value) => {
        pending = value;
      }}
    />,
  );
}

function CommentCard({
  card,
  close,
  pending,
}: {
  card: Card;
  close: () => void;
  pending: (value: boolean) => void;
}) {
  const { capture } = card;
  const [record, setRecord] = useState<Annotation>();
  const key = draftKey(card);
  const restored = drafts.get(key);
  const [mode, setMode] = useState<'read' | 'edit' | 'reply'>(
    restored?.mode ?? (card.existing && !card.editOnOpen ? 'read' : 'edit'),
  );
  const [text, setText] = useState(restored?.text ?? '');
  const [reviewed, showReviewed] = useState<Annotation>();
  const [receipt, setReceipt] = useState('');
  const [error, setError] = useState(
    pendingChanges.has(key) ? 'Save could not be confirmed. Read latest before saving again.' : '',
  );
  const [busy, setBusy] = useState(false);
  const [version, refresh] = useState(0);
  const [missing, setMissing] = useState(false);
  const frame = useRef<HTMLElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const locked = useRef(false);
  const invalidDraft = !text.trim() || (card.existing && (!!error || !record));
  const [session] = useState(() => {
    const session = annotationMutationSession<Annotation>({
      id: capture.id,
      pending: pendingChanges.get(key),
      onPending: (change) => {
        if (change) pendingChanges.set(key, change);
        else pendingChanges.delete(key);
      },
      read: async () =>
        (await annotationMessage({ action: 'card-read', url: capture.url, id: capture.id })).record,
      write: (change) => annotationMessage({ action: 'card-change', url: capture.url, change }),
      publish: setRecord,
      invalidate: () => refresh((value) => value + 1),
    });
    session.setBase(restored?.revision);
    return session;
  });
  useEffect(() => {
    if (!card.existing && !version) return;
    let active = true;
    void annotationMessage({ action: 'card-read', url: capture.url, id: capture.id }).then(
      ({ record }) => {
        if (active && record) session.accept(record);
      },
      (e) => {
        if (active && !session.current()) setError(String(e));
      },
    );
    return () => {
      active = false;
    };
  }, [card, capture, session, version]);
  useEffect(() => {
    const position = () => {
      const el = frame.current;
      if (!el) return;
      const r = card.rect();
      setMissing(!r);
      const left = r ? r.left : innerWidth - el.offsetWidth - 12;
      const below = r ? r.bottom + 8 : 12;
      const top = r && below + el.offsetHeight > innerHeight ? r.top - el.offsetHeight - 8 : below;
      el.style.left = Math.max(8, Math.min(innerWidth - el.offsetWidth - 8, left)) + 'px';
      el.style.top = Math.max(8, Math.min(innerHeight - el.offsetHeight - 8, top)) + 'px';
    };
    position();
    const observer = new ResizeObserver(position);
    if (frame.current) observer.observe(frame.current);
    const layout = new MutationObserver(position);
    layout.observe(document.body, { childList: true, subtree: true, characterData: true });
    addEventListener('scroll', position, true);
    addEventListener('resize', position);
    return () => {
      layout.disconnect();
      observer.disconnect();
      removeEventListener('scroll', position, true);
      removeEventListener('resize', position);
    };
  }, [card]);
  useEffect(() => {
    (field.current ?? frame.current)?.focus({ preventScroll: true });
  }, [mode]);
  async function submit(action: AnnotationChange['action']) {
    if (locked.current) return;
    locked.current = true;
    pending(true);
    setBusy(true);
    setError('');
    setReceipt('');
    try {
      if (!card.existing && !record) {
        const result = await annotationMessage({
          action: 'capture',
          capture: { ...capture, comment: text },
        });
        if (!result.records?.length) throw new Error('Could not confirm the saved comment.');
        const saved = result.records[0]!;
        const savedText =
          text.length > 500
            ? (await annotationMessage({ action: 'card-read', url: capture.url, id: saved.id }))
                .record?.comment
            : saved.comment;
        if (savedText !== text)
          throw new Error(
            'This annotation was already saved. Open it from the page index to review the saved comment.',
          );
        drafts.delete(key);
        close();
        card.saved?.();
        return;
      }
      if (!record) throw new Error('Read the annotation again.');
      await session.change(action, action === 'edit' || action === 'append' ? text : undefined);
      drafts.delete(key);
      session.setBase(undefined);
      setReceipt(
        action === 'append'
          ? 'Reply added'
          : action === 'complete'
            ? 'Marked done'
            : action === 'reopen'
              ? 'Reopened'
              : 'Comment saved',
      );
      setText('');
      setMode('read');
      showReviewed(undefined);
    } catch (e) {
      showReviewed(undefined);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      locked.current = false;
      pending(false);
      setBusy(false);
    }
  }
  function setErrorFromCause(cause: unknown) {
    setError(String(cause));
  }
  async function reviewLatest() {
    if (locked.current) return;
    locked.current = true;
    pending(true);
    setBusy(true);
    try {
      const { record: saved, confirmed } = await session.review();
      if (!saved) throw new Error('Annotation unavailable.');
      if (!session.accept(saved)) throw new Error('Annotation changed. Read latest again.');
      session.setBase(saved.revision);
      if (confirmed && (mode === 'read' || confirmed.text === text)) {
        session.setBase(undefined);
        drafts.delete(key);
        setText('');
        setMode('read');
        setReceipt('Change saved');
        showReviewed(undefined);
      } else {
        showReviewed(saved);
        const draft = drafts.get(key);
        if (draft) drafts.set(key, { ...draft, revision: saved.revision });
      }
      setError('');
    } catch (cause) {
      setError(String(cause));
    } finally {
      locked.current = false;
      pending(false);
      setBusy(false);
    }
  }
  return (
    <section
      role="dialog"
      aria-label="Annotation"
      ref={frame}
      tabIndex={-1}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' && !busy) close();
      }}
    >
      <header>
        <strong>
          {record ? 'Annotation ' + record.number : card.existing ? 'Annotation' : 'New annotation'}
        </strong>
        <button disabled={busy} onClick={close} aria-label="Close annotation">
          ×
        </button>
      </header>
      <blockquote>{capture.target.label}</blockquote>
      {receipt && <small role="status">{receipt}</small>}
      {missing && <small>Target unavailable on this page.</small>}
      {record?.imageError && <small>{record.imageError}</small>}
      {mode !== 'read' && reviewed && <p>Latest saved comment: {reviewed.comment}</p>}
      {mode === 'read' && record && (
        <>
          {record.state === 'done' && <small>Done</small>}
          <p>{record.comment || 'Empty comment'}</p>
          {!!record.replies.length && (
            <details>
              <summary>Replies · {record.replies.length}</summary>
              {record.replies.map((r) => (
                <p key={r.id}>
                  <strong>{r.author.name}</strong>
                  <br />
                  {r.text}
                </p>
              ))}
            </details>
          )}
          <footer>
            <button
              disabled={busy}
              onClick={() => {
                setReceipt('');
                setText('');
                session.setBase(record.revision);
                setMode('reply');
              }}
            >
              Reply
            </button>
            <button disabled={missing || busy} onClick={card.locate}>
              Locate
            </button>
            <details>
              <summary>More</summary>
              <button
                disabled={busy}
                onClick={() => {
                  setReceipt('');
                  setText(record.comment);
                  session.setBase(record.revision);
                  setMode('edit');
                }}
              >
                Edit comment
              </button>
              <button
                disabled={busy || !!error}
                onClick={() =>
                  session.enqueue(
                    () => submit(record.state === 'open' ? 'complete' : 'reopen'),
                    setErrorFromCause,
                  )
                }
              >
                {record.state === 'open' ? 'Mark done' : 'Reopen'}
              </button>
            </details>
          </footer>
        </>
      )}
      {mode !== 'read' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!locked.current && !invalidDraft)
              session.enqueue(
                () => submit(mode === 'reply' ? 'append' : 'edit'),
                setErrorFromCause,
              );
          }}
        >
          <label>
            {mode === 'reply' ? 'Reply' : 'Comment'}
            <textarea
              ref={field}
              rows={3}
              value={text}
              readOnly={busy}
              maxLength={16000}
              onChange={(e) => {
                setText(e.target.value);
                if (session.base() === undefined) session.setBase(record?.revision);
                drafts.set(key, {
                  id: capture.id,
                  text: e.target.value,
                  mode,
                  revision: session.base(),
                });
              }}
            />
          </label>
          <footer>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                drafts.delete(key);
                session.setBase(undefined);
                showReviewed(undefined);
                if (!pendingChanges.has(key)) setError('');
                if (!record) close();
                else {
                  setText('');
                  setMode('read');
                }
              }}
            >
              Cancel
            </button>
            <button className="primary" disabled={invalidDraft} aria-disabled={busy || undefined}>
              {busy ? 'Saving…' : mode === 'reply' ? 'Add reply' : 'Save comment'}
            </button>
          </footer>
        </form>
      )}
      {error && (
        <p role="alert">
          {error}{' '}
          {card.existing && (
            <button disabled={busy} onClick={() => void reviewLatest()}>
              Read latest
            </button>
          )}
        </p>
      )}
    </section>
  );
}
