import { useCallback, useEffect, useRef, useState } from 'react';
import {
  activeAnnotationAttempt,
  type AnnotationAttemptStatus,
  type AnnotationEditorCapture,
  type AnnotationEditorRecord,
  type AnnotationEditorStatus,
  type AnnotationStatusKey,
} from '../../shared/protocol/annotation-attempts.ts';
import { annotationMessage, annotations } from './client';
import { annotationMutationSession } from './mutation-session';
import { annotationDraftKey, annotationVersionKey } from './routing';
import type { AnnotationChange } from '../../shared/protocol/annotations.ts';
import { createStatusObserver, type StatusObserver } from '../observation/status-observer';

type CommentDraft =
  | { phase: 'loading' | 'saved' | 'saving'; text: string }
  | { phase: 'blocked'; text: string; error: string };

type StoredDraft = { text: string; revision?: number };
function storedDraft(value: unknown): StoredDraft | undefined {
  if (!value || typeof value !== 'object' || !('text' in value) || typeof value.text !== 'string')
    return;
  const revision = 'revision' in value ? value.revision : undefined;
  return {
    text: value.text,
    ...(typeof revision === 'number' && Number.isSafeInteger(revision) && revision > 0
      ? { revision }
      : {}),
  };
}
type EditorRead = { status: AnnotationEditorStatus; recovered?: StoredDraft };
type CommentSave = {
  draft: CommentDraft;
  token: string;
  persisted: Promise<void>;
  revision?: number;
};

export function useAnnotationEditorSession({
  id,
  url,
  deleted = false,
  updated,
}: {
  id: string;
  url: string;
  deleted?: boolean;
  updated: () => void;
}) {
  const [record, setRecord] = useState<AnnotationEditorRecord>(),
    [capture, setCapture] = useState<AnnotationEditorCapture>({ kind: 'none' }),
    [draft, showDraft] = useState<CommentDraft>({ phase: 'loading', text: '' }),
    [reply, showReply] = useState(''),
    [replyPending, setReplyPending] = useState(false),
    [error, setError] = useState(''),
    [readError, setReadError] = useState(''),
    [missing, setMissing] = useState(false),
    [runs, setRuns] = useState<AnnotationAttemptStatus[]>([]),
    [reviewed, showReviewed] = useState<AnnotationEditorRecord>(),
    [reviewing, setReviewing] = useState(false);
  const currentDraft = useRef(draft);
  const replyDraft = useRef({ text: '' });
  const submittingReply = useRef(false);
  const latestDraftToken = useRef<string>(undefined);
  const pendingSave = useRef<{ value: CommentSave } | undefined>(undefined);
  const statusObserver = useRef<StatusObserver<EditorRead> | null>(null);
  const mounted = useRef(false);
  const visibility = deleted ? 'masked' : undefined;
  const [session] = useState(() =>
    annotationMutationSession<AnnotationEditorRecord>({
      id,
      read: async () => {
        const status = await annotationMessage({ action: 'status', url, id, visibility });
        if (status.kind === 'missing') return undefined;
        return (await annotations(url, { action: 'read', id, image: false, visibility })).record;
      },
      write: (change) => annotations(url, { action: 'change', changes: [change] }),
      publish: setRecord,
      invalidate: () => void statusObserver.current?.invalidate(),
    }),
  );
  const draftKey = annotationDraftKey(id);
  const publishDraft = useCallback((next: CommentDraft) => {
    currentDraft.current = next;
    if (mounted.current) showDraft(next);
  }, []);
  useEffect(() => {
    mounted.current = true;
    let known: AnnotationStatusKey | undefined;
    const observer = createStatusObserver<EditorRead>({
      read: async () => {
        const recovered =
          currentDraft.current.phase === 'loading'
            ? storedDraft((await chrome.storage.local.get(draftKey))[draftKey])
            : undefined;
        return {
          status: await annotationMessage({ action: 'status', url, id, known, visibility }),
          recovered,
        };
      },
      shouldPoll: ({ status }) =>
        status.kind === 'found' && status.attempts.some(activeAnnotationAttempt),
      onSnapshot: ({ value, error }) => {
        setReadError(error ?? '');
        if (!value || error) return;
        const { status, recovered } = value;
        if (status.kind === 'missing') {
          known = undefined;
          setMissing(true);
          return;
        }
        if (status.key.revision < (session.current()?.revision ?? 0)) return;
        known = status.key;
        setMissing(false);
        if (status.capture) setCapture(status.capture);
        setRuns(status.attempts);
        const saved = status.record;
        if (!saved || !session.accept(saved)) return;
        const phase = currentDraft.current.phase;
        if (phase === 'loading' && recovered) {
          session.setBase(recovered.revision ?? saved.revision);
          publishDraft({
            phase: 'blocked',
            text: recovered.text,
            error: 'An unsaved draft was restored. Review the current comment before saving it.',
          });
        } else if (phase === 'loading' || phase === 'saved') {
          session.setBase(saved.revision);
          publishDraft({ phase: 'saved', text: saved.comment });
        }
      },
      intervalMs: 1000,
    });
    statusObserver.current = observer;
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && changes[annotationVersionKey]) void observer.invalidate();
    };
    chrome.storage.onChanged.addListener(changed);
    void observer.refresh();
    return () => {
      mounted.current = false;
      statusObserver.current = null;
      observer.dispose();
      chrome.storage.onChanged.removeListener(changed);
    };
  }, [id, url, visibility, draftKey, publishDraft, session]);
  const enqueue = (work: () => Promise<void>) => {
    session.enqueue(work, (cause) => {
      if (mounted.current) setError(String(cause));
    });
  };
  const setReply = (text: string) => {
    replyDraft.current = { text };
    showReply(text);
  };
  const save = (text: string, review = false) => {
    const before = currentDraft.current;
    const revision = review ? reviewed?.revision : undefined;
    if (review && revision === undefined) return;
    const next: CommentDraft =
      before.phase === 'blocked' && !review ? { ...before, text } : { phase: 'saving', text };
    publishDraft(next);
    const token = crypto.randomUUID();
    latestDraftToken.current = token;
    const persist = annotationMessage({
      action: 'draft',
      mutation: { action: 'write', id, token, text, revision: revision ?? session.base() },
    });
    void persist.catch(() => undefined);
    // Persist recovery text as before. Coalesce only the queued SQLite edits;
    // commands seal the current slot to keep their order relative to typing.
    const value = {
      draft: next,
      token,
      persisted: persist,
      revision: revision ?? pendingSave.current?.value.revision,
    };
    if (pendingSave.current) {
      pendingSave.current.value = value;
      return;
    }
    const slot = { value };
    pendingSave.current = slot;
    enqueue(async () => {
      if (pendingSave.current === slot) pendingSave.current = undefined;
      const { draft: submitted, token, persisted, revision } = slot.value;
      try {
        await persisted;
        if (submitted.phase === 'blocked' || currentDraft.current.phase === 'blocked') return;
        await session.change('edit', submitted.text, revision);
        if (mounted.current) showReviewed(undefined);
        if (currentDraft.current !== submitted) return;
        await annotationMessage({ action: 'draft', mutation: { action: 'clear', id, token } });
        if (currentDraft.current === submitted) {
          const latest = session.current();
          if (latest && latest.revision >= (session.base() ?? 0)) {
            // Observation may advance the clean editor only after all local text
            // was accepted. A queued or blocked draft keeps its own edit base.
            session.setBase(latest.revision);
            publishDraft({ phase: 'saved', text: latest.comment });
          } else publishDraft({ phase: 'saved', text: submitted.text });
        }
      } catch (cause) {
        // Whether this save or a newer queued edit was active, retain its text
        // and stop sending edits until the author explicitly reviews the base.
        if (mounted.current) showReviewed(undefined);
        publishDraft({
          phase: 'blocked',
          text: currentDraft.current.text,
          error: String(cause),
        });
        void statusObserver.current?.invalidate();
      }
    });
  };
  const act = (action: Exclude<AnnotationChange['action'], 'edit' | 'append'>) => {
    pendingSave.current = undefined;
    enqueue(async () => {
      if (currentDraft.current.phase === 'blocked' && action !== 'purge') return;
      await session.change(action, undefined, action === 'purge' ? record?.revision : undefined);
      if (action === 'purge')
        await annotationMessage({ action: 'draft', mutation: { action: 'purge', id } });
      if (mounted.current) {
        setError('');
        updated();
      }
    });
  };
  const submitReply = () => {
    const submitted = replyDraft.current;
    if (submittingReply.current || !submitted.text.trim()) return;
    submittingReply.current = true;
    setReplyPending(true);
    pendingSave.current = undefined;
    enqueue(async () => {
      try {
        if (currentDraft.current.phase === 'blocked') return;
        await session.change('append', submitted.text);
        if (mounted.current) {
          if (replyDraft.current === submitted) setReply('');
          setError('');
          updated();
        }
      } finally {
        submittingReply.current = false;
        if (mounted.current) setReplyPending(false);
      }
    });
  };
  const reviewLatest = () => {
    setReviewing(true);
    const submitted = replyDraft.current;
    enqueue(async () => {
      try {
        const { record: saved, confirmed } = await session.review();
        if (!mounted.current) return;
        if (!saved) {
          setMissing(true);
          if (confirmed?.action === 'purge')
            await annotationMessage({ action: 'draft', mutation: { action: 'purge', id } });
          return;
        }
        if (!session.accept(saved)) throw new Error('Annotation changed. Read latest again.');
        if (
          confirmed?.action === 'append' &&
          replyDraft.current === submitted &&
          submitted.text === confirmed.text
        )
          setReply('');
        const draftAtReview = currentDraft.current;
        const token = latestDraftToken.current;
        if (confirmed?.action === 'edit' && token && draftAtReview.text === confirmed.text) {
          await annotationMessage({ action: 'draft', mutation: { action: 'clear', id, token } });
          if (currentDraft.current === draftAtReview) {
            session.setBase(saved.revision);
            publishDraft({ phase: 'saved', text: saved.comment });
            setError('');
            return;
          }
        }
        if (currentDraft.current.phase === 'blocked') showReviewed(saved);
        else {
          session.setBase(saved.revision);
          publishDraft({ phase: 'saved', text: saved.comment });
        }
        setError('');
      } finally {
        if (mounted.current) setReviewing(false);
      }
    });
  };
  return {
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
    refresh: () => statusObserver.current?.refresh(),
    stop: async (attemptId: string) => {
      try {
        await annotationMessage({ action: 'stop', id: attemptId });
        if (mounted.current) void statusObserver.current?.invalidate();
      } catch (error) {
        if (mounted.current) setError(String(error));
      }
    },
    save,
    act,
  };
}
