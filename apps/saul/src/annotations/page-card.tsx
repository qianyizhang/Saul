import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { annotationMessage } from './client';
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
  const baseRevision = useRef(restored?.revision);
  const [receipt, setReceipt] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, refresh] = useState(0);
  const [missing, setMissing] = useState(false);
  const frame = useRef<HTMLElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const retry = useRef<{ signature: string; id: string } | undefined>(undefined);
  const locked = useRef(false);
  useEffect(() => {
    if (!card.existing && !version) return;
    let active = true;
    void annotationMessage({ action: 'card-read', url: capture.url, id: capture.id }).then(
      (r) => {
        if (active && r.record) {
          setRecord(r.record);
          if (
            version &&
            retry.current &&
            r.record.operations.some((operation) => operation.id === retry.current?.id)
          ) {
            drafts.delete(key);
            retry.current = undefined;
            baseRevision.current = undefined;
            setText('');
            setMode('read');
            setReceipt('Change saved');
          } else if (version) baseRevision.current = r.record.revision;
          setError('');
        }
      },
      (e) => {
        if (active) setError(String(e));
      },
    );
    return () => {
      active = false;
    };
  }, [card, capture, key, version]);
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
      const revision = baseRevision.current ?? record.revision;
      const signature = JSON.stringify([revision, action, text]);
      if (retry.current?.signature !== signature)
        retry.current = { signature, id: crypto.randomUUID() };
      const change = {
        id: record.id,
        revision,
        operationId: retry.current.id,
        action,
        ...(['append', 'edit'].includes(action) && { text }),
      };
      const result = await annotationMessage({ action: 'card-change', url: capture.url, change });
      const outcome = result.outcomes?.[0];
      if (!outcome?.record) throw new Error(outcome?.error ?? 'Could not confirm the change.');
      drafts.delete(key);
      baseRevision.current = undefined;
      setReceipt(
        action === 'append'
          ? 'Reply added'
          : action === 'complete'
            ? 'Marked done'
            : action === 'reopen'
              ? 'Reopened'
              : 'Comment saved',
      );
      refresh((value) => value + 1);
      setText('');
      setMode('read');
      retry.current = undefined;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
      {mode === 'edit' && version > 0 && record && <p>Latest saved comment: {record.comment}</p>}
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
                  setMode('edit');
                }}
              >
                Edit comment
              </button>
              <button
                disabled={busy}
                onClick={() => void submit(record.state === 'open' ? 'complete' : 'reopen')}
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
            void submit(mode === 'reply' ? 'append' : 'edit');
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
                baseRevision.current ??= record?.revision;
                drafts.set(key, {
                  id: capture.id,
                  text: e.target.value,
                  mode,
                  revision: baseRevision.current,
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
                baseRevision.current = undefined;
                if (!record) close();
                else {
                  setText('');
                  setMode('read');
                }
              }}
            >
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy || !text.trim() || (card.existing && !record)}
            >
              {busy ? 'Saving…' : mode === 'reply' ? 'Add reply' : 'Save comment'}
            </button>
          </footer>
        </form>
      )}
      {error && (
        <p role="alert">
          {error}{' '}
          {card.existing && (
            <button disabled={busy} onClick={() => refresh((v) => v + 1)}>
              Read latest
            </button>
          )}
        </p>
      )}
    </section>
  );
}
