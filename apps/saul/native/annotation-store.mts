import { createHash } from 'node:crypto';
import {
  activeAnnotationAttempt,
  annotationStatusSchema,
  type AnnotationAttempt,
  type AnnotationAttemptStatus,
  type AnnotationDbOperations,
  type AnnotationEditorRecord,
  type AnnotationEditorStatus,
  type AnnotationStatusKey,
} from '../src/annotations/attempts.ts';
import type { SqlDatabase } from '../src/storage/sql.ts';
import {
  requestSchema,
  captureSchema,
  retentionMs,
  summary,
  assertExternalAnnotationSize,
  MAX_ANNOTATION_BATCH,
  type Annotation,
  type AnnotationRequest,
  type AnnotationResult,
  type AnnotationScope,
  type AnnotationSummary,
} from '../src/annotations/contract.ts';

/** Additive, browser-owned tables in the existing shared database; EZ does not project these records. */
function tables(db: SqlDatabase) {
  db.exec(`CREATE TABLE IF NOT EXISTS browser_annotation(owner TEXT NOT NULL,id TEXT NOT NULL,url TEXT NOT NULL,deleted_at INTEGER,body TEXT NOT NULL,PRIMARY KEY(owner,id));
    CREATE INDEX IF NOT EXISTS browser_annotation_page ON browser_annotation(owner,url);
    CREATE TABLE IF NOT EXISTS browser_annotation_attempt(owner TEXT NOT NULL,id TEXT NOT NULL,annotation_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner,id),FOREIGN KEY(owner,annotation_id) REFERENCES browser_annotation(owner,id) ON DELETE CASCADE);`);
}
function allowed(a: Pick<Annotation, 'id' | 'url'>, scope: AnnotationScope) {
  return scope.ids.includes(a.id) || scope.urls.includes(a.url);
}
export function annotationStore(
  db: SqlDatabase,
  owner: string,
  request: AnnotationDbOperations['DB_ANNOTATION']['payload'],
  now = Date.now(),
): AnnotationResult {
  tables(db);
  const { external, ...input } = request;
  return db.transaction(() => {
    const result = applyAnnotationOperation(db, owner, input, now);
    // Reject before the transaction commits, even when each item fits by itself.
    if (external) assertExternalAnnotationSize(result, input.operation);
    return result;
  });
}
function applyAnnotationOperation(
  db: SqlDatabase,
  owner: string,
  request: AnnotationRequest,
  now: number,
): AnnotationResult {
  const { scope, author, operation: op } = requestSchema.parse(request);
  db.exec({
    sql: 'DELETE FROM browser_annotation WHERE owner=? AND deleted_at<=?',
    bind: [owner, now - retentionMs],
  });
  const read = (id: string) => {
    const row = db.selectObject('SELECT body FROM browser_annotation WHERE owner=? AND id=?', [
      owner,
      id,
    ]);
    if (!row) throw new Error('Annotation unavailable. It may have been permanently deleted.');
    const a = JSON.parse(String(row.body)) as Annotation;
    if (!allowed(a, scope)) throw new Error('Annotation is outside the assigned scope.');
    return a;
  };
  const write = (a: Annotation) =>
    db.exec({
      sql: 'INSERT INTO browser_annotation(owner,id,url,deleted_at,body) VALUES (?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET deleted_at=excluded.deleted_at,body=excluded.body',
      bind: [owner, a.id, a.url, a.deletedAt ?? null, JSON.stringify(a)],
    });
  if (op.action === 'list') {
    if (!scope.urls.includes(op.url) && !scope.ids.length)
      throw new Error('Page is outside the assigned scope.');
    const scopedPage = scope.urls.includes(op.url);
    const rows = db.selectObjects(
      `SELECT json_remove(body,'$.image','$.operations','$.replies') AS summary,
          json_type(body,'$.image')='text' AS has_image,
          json_array_length(body,'$.replies') AS reply_count
        FROM browser_annotation WHERE owner=? AND url=?
          AND (? OR id IN (SELECT value FROM json_each(?)))
          AND ${op.filter === 'deleted' ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'}
          AND (? IN ('all','deleted') OR json_extract(body,'$.state')=?)
        ORDER BY rowid LIMIT 26 OFFSET ?`,
      [
        owner,
        op.url,
        Number(scopedPage),
        JSON.stringify(scope.ids),
        op.filter,
        op.filter,
        op.offset,
      ],
    );
    return {
      records: rows.slice(0, 25).map((row) => {
        const item = JSON.parse(String(row.summary)) as Omit<
          AnnotationSummary,
          'hasImage' | 'replyCount'
        >;
        return {
          ...item,
          comment: item.comment.slice(0, 500),
          hasImage: Boolean(row.has_image),
          replyCount: Number(row.reply_count),
        };
      }),
      ...(rows.length > 25 ? { nextOffset: op.offset + 25 } : {}),
    };
  }
  if (op.action === 'read') {
    const a = read(op.id);
    if (!op.image) delete a.image;
    return { record: a };
  }
  if (op.action === 'create') {
    if (!scope.urls.includes(op.capture.url))
      throw new Error('Creating an annotation requires its page in scope.');
    const prior = db.selectObject('SELECT body FROM browser_annotation WHERE owner=? AND id=?', [
      owner,
      op.capture.id,
    ]);
    if (prior) {
      const a = read(op.capture.id);
      if (a.url !== op.capture.url) throw new Error('Capture ID belongs to another page.');
      return { records: [summary(a)] };
    }
    const number =
      Number(
        db.selectValue(
          "SELECT COALESCE(MAX(json_extract(body,'$.number')),0) FROM browser_annotation WHERE owner=? AND url=?",
          [owner, op.capture.url],
        ),
      ) + 1;
    const a: Annotation = {
      ...op.capture,
      number,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      author,
      state: 'open',
      replies: [],
      operations: [],
    };
    write(a);
    return { records: [summary(a)] };
  }
  return {
    outcomes: op.changes.map((change) => {
      try {
        const a = read(change.id);
        const signature = createHash('sha256')
          .update(JSON.stringify({ action: change.action, text: change.text }))
          .digest('hex');
        const prior = a.operations.find((o) => o.id === change.operationId);
        if (prior) {
          if (prior.signature !== signature)
            throw new Error('Operation ID was already used for a different edit.');
          return { id: a.id, record: summary(a) };
        }
        if (a.revision !== change.revision)
          throw new Error(
            'Annotation changed. Review the latest version before applying this edit.',
          );
        if (a.deletedAt !== undefined && !['restore', 'purge'].includes(change.action))
          throw new Error('Restore this annotation before editing it.');
        switch (change.action) {
          case 'edit':
            a.comment = change.text!;
            a.editedBy = author;
            break;
          case 'append':
            if (!change.text?.trim()) throw new Error('Reply must not be empty.');
            if (a.replies.length >= 100)
              throw new Error('This annotation has reached 100 replies.');
            a.replies.push({ id: change.operationId, text: change.text, author, createdAt: now });
            break;
          case 'complete':
            a.state = 'done';
            break;
          case 'reopen':
            a.state = 'open';
            break;
          case 'delete':
            a.deletedAt = now;
            db.exec({
              sql: `UPDATE browser_annotation_attempt
                  SET body=json_set(body,'$.status','cancelled','$.error','Annotation deleted.')
                  WHERE owner=? AND annotation_id=?
                    AND json_extract(body,'$.status') IN ('queued','running','saving')`,
              bind: [owner, a.id],
            });
            break;
          case 'restore':
            delete a.deletedAt;
            break;
          case 'purge':
            if (a.deletedAt === undefined)
              throw new Error('Delete the annotation before permanently removing it.');
            db.exec({
              sql: 'DELETE FROM browser_annotation WHERE owner=? AND id=?',
              bind: [owner, a.id],
            });
            return { id: a.id };
          case 'remove-image':
            delete a.image;
            a.imageError = 'Image removed.';
            break;
        }
        a.operations.push({ id: change.operationId, signature });
        a.updatedAt = now;
        a.revision++;
        write(a);
        return { id: a.id, record: summary(a) };
      } catch (e) {
        return { id: change.id, error: (e as Error).message };
      }
    }),
  };
}

export function annotationStatus(
  db: SqlDatabase,
  owner: string,
  input: AnnotationDbOperations['DB_ANNOTATION_STATUS']['payload'],
  now = Date.now(),
): AnnotationEditorStatus {
  const { id, url, known } = annotationStatusSchema.parse(input);
  // An unused workspace may not have initialized its annotation tables.
  if (
    !db.selectValue(
      "SELECT 1 FROM sqlite_schema WHERE type='table' AND name='browser_annotation_attempt'",
    )
  )
    return { kind: 'missing' };
  // A single SELECT gives the record, capture and attempts the same SQLite snapshot.
  // Do not prune old rows or take a writer reservation while observing.
  const row = db.selectObject(
    `WITH selected AS (
      SELECT owner,id,body,json_extract(body,'$.revision') AS revision,
        CASE WHEN json_type(body,'$.image')='text' THEN 'available'
             WHEN json_type(body,'$.imageError')='text' THEN 'unavailable' ELSE 'none' END AS capture
      FROM browser_annotation WHERE owner=? AND id=? AND url=?
        AND (deleted_at IS NULL OR deleted_at>?)
    )
    SELECT revision,capture,
      CASE WHEN revision IS NOT ? THEN json_remove(body,'$.image','$.imageError','$.operations') END AS record,
      CASE WHEN capture='available' AND capture IS NOT ? THEN json_extract(body,'$.image') END AS image,
      CASE WHEN capture='unavailable' AND (capture IS NOT ? OR revision IS NOT ?)
        THEN json_extract(body,'$.imageError') END AS image_error,
      (SELECT json_group_array(json_object('id',id,'status',status,'presetName',preset_name,'error',error))
        FROM (SELECT t.id,json_extract(t.body,'$.status') AS status,
           json_extract(t.body,'$.input.preset.name') AS preset_name,
           substr(json_extract(t.body,'$.error'),1,2000) AS error
          FROM browser_annotation_attempt t
          WHERE t.owner=selected.owner AND t.annotation_id=selected.id
          ORDER BY t.rowid DESC LIMIT 10)) AS attempts
    FROM selected`,
    [
      owner,
      id,
      url,
      now - retentionMs,
      known?.revision ?? null,
      known?.capture ?? null,
      known?.capture ?? null,
      known?.revision ?? null,
    ],
  );
  if (!row) return { kind: 'missing' };
  const key = {
    revision: Number(row.revision),
    capture: row.capture as AnnotationStatusKey['capture'],
  };
  const attempts = (
    JSON.parse(String(row.attempts)) as (Pick<AnnotationAttemptStatus, 'id' | 'status'> & {
      presetName: string | null;
      error: string | null;
    })[]
  ).map(({ id, status, presetName, error }) => ({
    id,
    status,
    ...(presetName !== null ? { presetName } : {}),
    ...(error !== null ? { error } : {}),
  }));
  return {
    kind: 'found',
    key,
    attempts,
    ...(row.record ? { record: JSON.parse(String(row.record)) as AnnotationEditorRecord } : {}),
    ...(typeof row.image === 'string'
      ? { capture: { kind: 'available', image: row.image } }
      : typeof row.image_error === 'string'
        ? { capture: { kind: 'unavailable', error: row.image_error } }
        : key.capture === 'none' && key.capture !== known?.capture
          ? { capture: { kind: 'none' } }
          : {}),
  };
}

export function annotationAttempts(
  db: SqlDatabase,
  owner: string,
  p: AnnotationDbOperations['DB_ANNOTATION_ATTEMPT']['payload'],
): AnnotationAttempt[] {
  tables(db);
  return db.transaction(() => {
    db.exec({
      sql: 'DELETE FROM browser_annotation WHERE owner=? AND deleted_at<=?',
      bind: [owner, Date.now() - retentionMs],
    });
    const validate = (a: AnnotationAttempt) => {
      if (
        !a ||
        typeof a.id !== 'string' ||
        !a.annotationId ||
        !a.input ||
        typeof a.raw !== 'string' ||
        a.raw.length > 60000 ||
        JSON.stringify(a).length > 900000
      )
        throw new Error('Invalid annotation attempt.');
    };
    if (p.action === 'admit') {
      if (
        !Array.isArray(p.attempts) ||
        !p.attempts.length ||
        p.attempts.length > MAX_ANNOTATION_BATCH
      )
        throw new Error('Invalid annotation attempt batch.');
      for (const a of p.attempts) {
        validate(a);
        const current = db.selectValue(
          "SELECT json_extract(body,'$.revision') FROM browser_annotation WHERE owner=? AND id=? AND deleted_at IS NULL",
          [owner, a.annotationId],
        );
        if (current !== a.revision || a.status !== 'queued')
          throw new Error(
            'Annotation changed before its inputs were saved. Review it and run again.',
          );
        db.exec({
          sql: 'INSERT INTO browser_annotation_attempt(owner,id,annotation_id,body) VALUES (?,?,?,?)',
          bind: [owner, a.id, a.annotationId, JSON.stringify(a)],
        });
      }
      return [];
    }
    if (p.action === 'save' || p.action === 'complete') {
      const a = p.attempt;
      validate(a);
      const previous = db.selectValue(
        `SELECT json_extract(t.body,'$.status')
          FROM browser_annotation_attempt t JOIN browser_annotation a
            ON t.owner=a.owner AND t.annotation_id=a.id
          WHERE t.owner=? AND t.id=? AND t.annotation_id=? AND a.deleted_at IS NULL`,
        [owner, a.id, a.annotationId],
      );
      if (previous === undefined || previous === null)
        throw new Error('Annotation or attempt is no longer available.');
      // A lost terminal acknowledgement must never turn saved completion into failure.
      if (previous !== 'queued' && previous !== 'running') return [];
      if (p.action === 'complete') {
        if (previous !== 'running' || a.status !== 'completed')
          throw new Error('Annotation attempt is no longer running.');
        const result = applyAnnotationOperation(
          db,
          owner,
          {
            scope: { ids: [a.annotationId], urls: [] },
            author: { kind: 'call', name: a.input.preset?.name ?? 'Respond to annotations' },
            operation: {
              action: 'change',
              changes: [
                {
                  id: a.annotationId,
                  revision: p.revision,
                  operationId: a.id,
                  action: 'append',
                  text: a.raw,
                },
              ],
            },
          },
          Date.now(),
        );
        if (result.outcomes?.[0]?.error) throw new Error(result.outcomes[0].error);
      } else if (!['running', 'failed', 'interrupted', 'cancelled'].includes(a.status)) {
        throw new Error('Invalid annotation attempt transition.');
      }
      db.exec({
        sql: 'UPDATE browser_annotation_attempt SET body=? WHERE owner=? AND id=?',
        bind: [JSON.stringify(a), owner, a.id],
      });
      return [];
    }
    if (p.action === 'recover') {
      const rows = db.selectObjects('SELECT body FROM browser_annotation_attempt WHERE owner=?', [
        owner,
      ]);
      for (const row of rows) {
        const a = JSON.parse(String(row.body)) as AnnotationAttempt;
        // Legacy split writes sometimes persisted an unsaved result. Keep the record
        // for inspection, without reviving any save-only recovery operation.
        const legacySave = String(a.status) === 'unsaved';
        if (!legacySave && !activeAnnotationAttempt(a)) continue;
        const recovered = {
          ...a,
          status: legacySave ? 'failed' : 'interrupted',
          error: legacySave
            ? 'The reply could not be saved. Run again explicitly.'
            : 'Runner stopped. Run again explicitly; no request was replayed.',
        };
        db.exec({
          sql: 'UPDATE browser_annotation_attempt SET body=? WHERE owner=? AND id=?',
          bind: [JSON.stringify(recovered), owner, a.id],
        });
      }
      return [];
    }
    if (p.action !== 'read') throw new Error('Unknown annotation attempt operation.');
    return db
      .selectObjects(
        'SELECT body FROM browser_annotation_attempt WHERE owner=?' +
          (p.annotationId ? ' AND annotation_id=?' : '') +
          (p.id ? ' AND id=?' : '') +
          ' ORDER BY rowid DESC LIMIT 10',
        [owner, ...(p.annotationId ? [p.annotationId] : []), ...(p.id ? [p.id] : [])],
      )
      .map((r) => {
        const attempt = JSON.parse(String(r.body)) as AnnotationAttempt;
        if (!p.id) delete attempt.image;
        return attempt;
      });
  });
}

export function annotationImage(
  db: SqlDatabase,
  owner: string,
  p: AnnotationDbOperations['DB_ANNOTATION_IMAGE']['payload'],
) {
  tables(db);
  db.transaction(() => {
    const row = db.selectObject(
      'SELECT body FROM browser_annotation WHERE owner=? AND id=? AND deleted_at IS NULL',
      [owner, p.id],
    );
    if (!row) throw new Error('Capture no longer exists.');
    const a = JSON.parse(String(row.body)) as Annotation;
    if (a.image || a.imageError) return;
    if (p.image) captureSchema.shape.image.parse(p.image);
    if (p.error && (typeof p.error !== 'string' || p.error.length > 2000))
      throw new Error('Invalid capture error.');
    if (p.image) a.image = p.image;
    else a.imageError = p.error || 'Screenshot unavailable.';
    db.exec({
      sql: 'UPDATE browser_annotation SET body=? WHERE owner=? AND id=?',
      bind: [JSON.stringify(a), owner, p.id],
    });
  });
}
