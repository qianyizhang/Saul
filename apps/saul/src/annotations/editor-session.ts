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

export function useAnnotationEditorSession({
  id,
  url,
  updated,
}: {
  id: string;
  url: string;
  updated: () => void;
}) {
  const [record, setRecord] = useState<AnnotationEditorRecord>(),
    [capture, setCapture] = useState<AnnotationEditorCapture>({ kind: 'none' }),
    [draft, showDraft] = useState<CommentDraft>({ phase: 'loading', text: '' }),
    [reply, setReply] = useState(''),
    [error, setError] = useState(''),
    [readError, setReadError] = useState(''),
    [missing, setMissing] = useState(false),
    [runs, setRuns] = useState<AnnotationAttemptStatus[]>([]);
  const currentDraft = useRef(draft);
  const latestRecord = useRef<AnnotationEditorRecord | undefined>(undefined);
  const baseRevision = useRef<number | undefined>(undefined);
  const edits = useRef(Promise.resolve());
  const statusObserver = useRef<StatusObserver<EditorRead> | null>(null);
  const mounted = useRef(false);
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
        return { status: await annotationMessage({ action: 'status', url, id, known }), recovered };
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
        known = status.key;
        setMissing(false);
        if (status.capture) setCapture(status.capture);
        setRuns(status.attempts);
        const saved = status.record;
        if (!saved) return;
        latestRecord.current = saved;
        setRecord(saved);
        const phase = currentDraft.current.phase;
        if (phase === 'loading' && recovered) {
          baseRevision.current = recovered.revision ?? saved.revision;
          publishDraft({
            phase: 'blocked',
            text: recovered.text,
            error: 'An unsaved draft was restored. Review the current comment before saving it.',
          });
        } else if (phase === 'loading' || phase === 'saved') {
          baseRevision.current = saved.revision;
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
  }, [id, url, draftKey, publishDraft]);
  const change = async (action: AnnotationChange['action'], text?: string) => {
    // Permanent deletion acts on the reviewed deleted record, even when its
    // separate unsaved comment still has an older edit base.
    const revision = action === 'purge' ? record?.revision : baseRevision.current;
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
    if (action === 'purge') {
      void statusObserver.current?.invalidate();
      return;
    }
    if (!outcome?.record) throw new Error('Annotation save was not confirmed.');
    // Advance the edit lane to the revision this write accepted, never to a
    // newer revision read while an unsaved local edit remains.
    if (
      currentDraft.current.phase !== 'saved' ||
      baseRevision.current === undefined ||
      baseRevision.current < outcome.record.revision
    )
      baseRevision.current = outcome.record.revision;
    // Invalidate immediately, but keep the observer out of the edit queue.
    void statusObserver.current?.invalidate();
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
    const token = crypto.randomUUID();
    const persist = annotationMessage({
      action: 'draft',
      mutation: { action: 'write', id, token, text, revision: baseRevision.current },
    });
    void persist.catch(() => undefined);
    enqueue(async () => {
      try {
        await persist;
        if (next.phase === 'blocked' || currentDraft.current.phase === 'blocked') return;
        await change('edit', text);
        if (currentDraft.current !== next) return;
        await annotationMessage({ action: 'draft', mutation: { action: 'clear', id, token } });
        if (currentDraft.current === next) {
          const latest = latestRecord.current;
          if (latest && latest.revision >= (baseRevision.current ?? 0)) {
            // Observation may advance the clean editor only after all local text
            // was accepted. A queued or blocked draft keeps its own edit base.
            baseRevision.current = latest.revision;
            publishDraft({ phase: 'saved', text: latest.comment });
          } else publishDraft({ phase: 'saved', text });
        }
      } catch (cause) {
        // Whether this save or a newer queued edit was active, retain its text
        // and stop sending edits until the author explicitly reviews the base.
        publishDraft({
          phase: 'blocked',
          text: currentDraft.current.text,
          error: String(cause),
        });
        void statusObserver.current?.invalidate();
      }
    });
  };
  const act = (action: AnnotationChange['action'], text?: string) => {
    enqueue(async () => {
      if (currentDraft.current.phase === 'blocked' && action !== 'purge') return;
      await change(action, text);
      if (action === 'purge')
        await annotationMessage({ action: 'draft', mutation: { action: 'purge', id } });
      if (mounted.current) {
        setReply('');
        setError('');
      }
      if (mounted.current) updated();
    });
  };
  return {
    record,
    capture,
    draft,
    reply,
    setReply,
    error,
    readError,
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
