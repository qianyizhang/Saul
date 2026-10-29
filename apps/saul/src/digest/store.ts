import type { Database } from '@sqlite.org/sqlite-wasm';
import type {
  DigestBatch,
  DigestDbOperations,
  DigestItem,
  DigestMeta,
  DigestSource,
} from './types';
type Request = {
  [K in keyof DigestDbOperations]: { type: K; payload: DigestDbOperations[K]['payload'] };
}[keyof DigestDbOperations];
export const DIGEST_SCHEMA = `
CREATE TABLE digest_batch (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE digest_item (batch_id TEXT NOT NULL REFERENCES digest_batch(id) ON DELETE CASCADE, position INTEGER NOT NULL, data TEXT NOT NULL, source TEXT, PRIMARY KEY(batch_id,position));`;
export function digestStore(db: Database, request: Request): unknown {
  const get = (id: string): DigestBatch => {
    const row = db.selectObject('SELECT data FROM digest_batch WHERE id=?', [id]);
    if (!row) throw new Error('This digest no longer exists.');
    return {
      ...(JSON.parse(String(row.data)) as DigestMeta),
      items: db
        .selectObjects('SELECT data FROM digest_item WHERE batch_id=? ORDER BY position', [id])
        .map((row) => JSON.parse(String(row.data)) as DigestItem),
    };
  };
  switch (request.type) {
    case 'DB_DIGEST_FIND': {
      // Match the exact ordered URL selection; retain settled partial/failed attempts too.
      // Source text stays in SQLite until comparison/inspection explicitly needs it.
      const row = db.selectObject(
        `SELECT b.id FROM digest_batch b
        WHERE COALESCE(json_extract(b.data,'$.action.revision.revision'),'')=?
        AND COALESCE(json_extract(b.data,'$.action.presetId'),'')=?
        AND (SELECT count(*) FROM digest_item i WHERE i.batch_id=b.id)=?
        AND NOT EXISTS (SELECT 1 FROM digest_item i WHERE i.batch_id=b.id
          AND (json_extract(i.data,'$.url') != json_extract(?, '$[' || i.position || ']')
            OR json_extract(i.data,'$.status') IN ('queued','capturing','running')))
        ORDER BY b.created_at DESC, b.rowid DESC LIMIT 1`,
        [
          request.payload.actionRevision || '',
          request.payload.actionPresetId || '',
          request.payload.urls.length,
          JSON.stringify(request.payload.urls),
        ],
      );
      return row ? get(String(row.id)) : undefined;
    }
    case 'DB_DIGEST_CREATE': {
      const { items, ...meta } = request.payload;
      db.transaction(() => {
        if (db.selectValue('SELECT id FROM digest_batch WHERE id=?', [meta.id])) return;
        db.exec({
          sql: 'INSERT INTO digest_batch VALUES (?,?,?)',
          bind: [meta.id, meta.createdAt, JSON.stringify(meta)],
        });
        for (const item of items)
          db.exec({
            sql: 'INSERT INTO digest_item(batch_id,position,data) VALUES (?,?,?)',
            bind: [meta.id, item.index, JSON.stringify(item)],
          });
      });
      return get(meta.id);
    }
    case 'DB_DIGEST_GET':
      return get(request.payload.id);
    case 'DB_DIGEST_ACTION_REVISIONS':
      return db
        .selectObjects(
          "SELECT DISTINCT json_extract(data,'$.action.revision.revision') AS revision FROM digest_batch WHERE json_extract(data,'$.action.revision.revision') IS NOT NULL",
        )
        .map((r) => String(r.revision));
    case 'DB_DIGEST_LIST':
      return db
        .selectObjects('SELECT id,created_at,data FROM digest_batch ORDER BY created_at DESC')
        .map((r) => ({
          id: String(r.id),
          createdAt: Number(r.created_at),
          windowTitle: (JSON.parse(String(r.data)) as DigestMeta).windowTitle,
        }));
    case 'DB_DIGEST_ITEM': {
      const { id, item, source } = request.payload;
      db.exec({
        sql:
          'UPDATE digest_item SET data=?' +
          (source ? ',source=?' : '') +
          ' WHERE batch_id=? AND position=?',
        bind: [JSON.stringify(item), ...(source ? [JSON.stringify(source)] : []), id, item.index],
      });
      if (db.changes() !== 1) throw new Error('Digest item could not be saved.');
      return;
    }
    case 'DB_DIGEST_SOURCE': {
      const row = db.selectObject(
        'SELECT source FROM digest_item WHERE batch_id=? AND position=?',
        [request.payload.id, request.payload.index],
      );
      return row?.source ? (JSON.parse(String(row.source)) as DigestSource) : undefined;
    }
    case 'DB_DIGEST_DELETE':
      db.exec({ sql: 'DELETE FROM digest_batch WHERE id=?', bind: [request.payload.id] });
      return;
    case 'DB_DIGEST_RECOVER':
      db.transaction(() => {
        for (const row of db.selectObjects('SELECT batch_id,position,data FROM digest_item')) {
          const item = JSON.parse(String(row.data)) as DigestItem;
          if (!['queued', 'capturing', 'running'].includes(item.status)) continue;
          item.status = 'interrupted';
          item.error = 'Interrupted when Saul restarted. Retry unfinished tabs explicitly.';
          db.exec({
            sql: 'UPDATE digest_item SET data=? WHERE batch_id=? AND position=?',
            bind: [JSON.stringify(item), row.batch_id!, row.position!],
          });
        }
      });
      return;
  }
}
