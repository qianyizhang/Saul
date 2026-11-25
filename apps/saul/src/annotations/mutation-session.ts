import type {
  Annotation,
  AnnotationChange,
  AnnotationResult,
  AnnotationSummary,
} from '../../shared/protocol/annotations.ts';

type EditorRecord = Pick<Annotation, 'revision' | 'comment' | 'replies'>;

/** One annotation's accepted record, draft base, and ordered write lane. */
export function annotationMutationSession<Record extends EditorRecord>({
  id,
  write,
  read,
  publish,
  invalidate,
  pending: initialPending,
  onPending,
}: {
  id: string;
  write: (change: AnnotationChange) => Promise<AnnotationResult>;
  read: () => Promise<(Record & Pick<Annotation, 'operations'>) | undefined>;
  publish: (record: Record) => void;
  invalidate: () => void;
  pending?: AnnotationChange;
  onPending?: (change: AnnotationChange | undefined) => void;
}) {
  let current: Record | undefined;
  let base: number | undefined;
  let pending = initialPending;
  function setPending(change: AnnotationChange | undefined) {
    pending = change;
    onPending?.(change);
  }
  let writes = Promise.resolve();

  function accept(record: Record) {
    if (current && record.revision < current.revision) return false;
    current = record;
    publish(record);
    return true;
  }

  function acceptSummary(summary: AnnotationSummary, change: AnnotationChange) {
    if (!current || current.revision > change.revision) return;
    // Summaries clip the comment and omit replies, capture and operation history.
    // The submitted edit and reply carry their full text.
    const author = { kind: 'user', name: 'You' } as const;
    accept({
      ...current,
      revision: summary.revision,
      state: summary.state,
      updatedAt: summary.updatedAt,
      editedBy: summary.editedBy,
      deletedAt: summary.deletedAt,
      comment: change.action === 'edit' ? change.text! : current.comment,
      replies:
        change.action === 'append'
          ? [
              ...current.replies,
              {
                id: change.operationId,
                author,
                text: change.text!,
                createdAt: summary.updatedAt,
              },
            ]
          : current.replies,
    });
  }

  async function inspect() {
    const record = await read();
    if (record && current && record.revision < current.revision)
      throw new Error('Annotation changed. Read latest again.');
    const change = pending;
    const confirmed =
      change &&
      (record?.operations.some((operation) => operation.id === change.operationId) ||
        (!record && change.action === 'purge'))
        ? change
        : undefined;
    return { record, confirmed };
  }

  return {
    accept,
    current: () => current,
    base: () => base,
    setBase: (revision: number | undefined) => {
      base = revision;
    },
    enqueue(work: () => Promise<void>, fail: (cause: unknown) => void) {
      writes = writes.then(work).catch(fail);
    },
    async review() {
      const snapshot = await inspect();
      setPending(undefined);
      return snapshot;
    },
    async change(
      action: AnnotationChange['action'],
      text?: string,
      revision = base ?? current?.revision,
    ) {
      if (pending) throw new Error('Read latest to confirm the previous change before saving.');
      if (revision === undefined) throw new Error('Annotation is still loading.');
      const change = { id, revision, operationId: crypto.randomUUID(), action, text };
      let outcome: NonNullable<AnnotationResult['outcomes']>[number] | undefined;
      try {
        outcome = (await write(change)).outcomes?.[0];
      } catch {
        // Delivery may have failed after SQLite committed. Inspect, never replay.
      }
      if (outcome?.error) throw new Error(outcome.error);
      if (outcome?.id === id && (outcome.record?.revision === revision + 1 || action === 'purge')) {
        base = outcome.record?.revision;
        if (outcome.record) acceptSummary(outcome.record, change);
        invalidate();
        return;
      }
      setPending(change);
      const snapshot = await inspect().catch(() => undefined);
      if (snapshot?.confirmed) {
        setPending(undefined);
        base = action === 'purge' ? undefined : revision + 1;
        if (snapshot.record) accept(snapshot.record);
        invalidate();
        return;
      }
      throw new Error('Save could not be confirmed. Read latest before saving again.');
    },
  };
}
