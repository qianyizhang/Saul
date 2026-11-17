import { createHash } from 'node:crypto';
import {
  activeAnnotationAttempt,
  type AnnotationAttempt,
  type AnnotationDbOperations,
} from '../src/annotations/attempts.ts';
import type { SqlDatabase } from '../src/storage/sql.ts';
import {
  requestSchema,
  captureSchema,
  retentionMs,
  summary,
  type Annotation,
  type AnnotationResult,
  type AnnotationScope,
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
  return db.transaction(() => applyAnnotationOperation(db, owner, request, now));
}
function applyAnnotationOperation(
  db: SqlDatabase,
  owner: string,
  request: AnnotationDbOperations['DB_ANNOTATION']['payload'],
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
    const rows = db
      .selectObjects('SELECT body FROM browser_annotation WHERE owner=? AND url=? ORDER BY rowid', [
        owner,
        op.url,
      ])
      .map((r) => JSON.parse(String(r.body)) as Annotation)
      .filter(
        (a) =>
          allowed(a, scope) &&
          (op.filter === 'deleted'
            ? a.deletedAt !== undefined
            : a.deletedAt === undefined && (op.filter === 'all' || a.state === op.filter)),
      );
    return {
      records: rows.slice(op.offset, op.offset + 25).map(summary),
      ...(rows.length > op.offset + 25 ? { nextOffset: op.offset + 25 } : {}),
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
      if (!Array.isArray(p.attempts) || !p.attempts.length || p.attempts.length > 20)
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
