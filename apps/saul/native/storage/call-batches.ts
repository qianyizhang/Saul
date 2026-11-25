import { callSchemas } from '../../shared/protocol/history-feature-schemas.mts';
import { writableSnapshot } from './stored-snapshot.ts';
import { historyCursor } from './history-cursor.ts';
import type { Row } from './sql.ts';
import { entryMask, maskFilter, recordMask, type HistoryVisibility } from './visibility.ts';
import { MISSING_CALL_BATCH } from '../../shared/model/call-batch.ts';
import type { SqlDatabase } from './sql.ts';
import {
  activeItem,
  interruptItem,
  restartItem,
  retryableItem,
  summaryTitle,
} from '../../shared/model/call-batch.ts';
import type {
  DigestBatch,
  DigestDbOperations,
  DigestItem,
  DigestMeta,
  DigestSource,
} from '../../shared/model/call-batch.ts';
type Request = {
  [K in keyof DigestDbOperations]: { type: K; payload: DigestDbOperations[K]['payload'] };
}[Exclude<keyof DigestDbOperations, 'DB_DIGEST_DELETE'>];
const batchMask = (id: string) => recordMask('calls', id);
const itemMask = (batch: string, position: string) =>
  entryMask('calls', batch, `CAST(${position} AS TEXT)`);
const itemVisibility = `COALESCE(${batchMask('digest_item.batch_id')},${itemMask('digest_item.batch_id', 'digest_item.position')})`;
const projectItem = (row: Row): DigestItem => ({
  ...(JSON.parse(String(row.data)) as DigestItem),
  ...(row.masked_at != null ? { maskedAt: Number(row.masked_at) } : {}),
});
export function digestStore(
  db: SqlDatabase,
  request: Request,
  owner = '',
  visibility: HistoryVisibility = 'visible',
): unknown {
  const get = (id: string): DigestBatch => {
    const row = db.selectObject(
      `SELECT data,${batchMask('digest_batch.id')} AS masked_at FROM digest_batch WHERE id=? AND ${maskFilter(batchMask('digest_batch.id'), visibility)}`,
      [id],
    );
    if (!row) throw new Error(MISSING_CALL_BATCH);
    return {
      ...(JSON.parse(String(row.data)) as DigestMeta),
      ...(row.masked_at != null ? { maskedAt: Number(row.masked_at) } : {}),
      items: db
        .selectObjects(
          `SELECT data,${itemVisibility} AS masked_at FROM digest_item
          WHERE batch_id=? AND ${visibility === 'visible' ? itemMask('digest_item.batch_id', 'digest_item.position') + ' IS NULL' : '1'}
          ORDER BY position`,
          [id],
        )
        .map(projectItem),
    };
  };
  function writeItem(id: string, item: DigestItem, source?: DigestSource) {
    const row = db.selectObject(
      `SELECT data${source ? ',source' : ''} FROM digest_item WHERE batch_id=? AND position=?
       AND ${itemVisibility} IS NULL`,
      [id, item.index],
    );
    if (!row) throw new Error('Digest item could not be saved.');
    writableSnapshot(callSchemas.item, String(row.data));
    if (source && row.source != null) writableSnapshot(callSchemas.source, String(row.source));
    db.exec({
      sql:
        'UPDATE digest_item SET data=?' +
        (source ? ',source=?' : '') +
        ' WHERE batch_id=? AND position=?',
      bind: [JSON.stringify(item), ...(source ? [JSON.stringify(source)] : []), id, item.index],
    });
  }
  switch (request.type) {
    case 'DB_DIGEST_FIND': {
      // Match the exact ordered URL selection; retain settled partial/failed attempts too.
      // Source text stays in SQLite until comparison/inspection explicitly needs it.
      const row = db.selectObject(
        `SELECT b.id FROM digest_batch b
        WHERE ${batchMask('b.id')} IS NULL AND COALESCE(json_extract(b.data,'$.action.revision.revision'),'')=?
        AND COALESCE(json_extract(b.data,'$.action.presetId'),'')=?
        AND (SELECT count(*) FROM digest_item i WHERE i.batch_id=b.id)=?
        AND NOT EXISTS (SELECT 1 FROM digest_item i WHERE i.batch_id=b.id
          AND (${itemMask('i.batch_id', 'i.position')} IS NOT NULL OR json_extract(i.data,'$.url') IS NOT json_extract(?, '$[' || i.position || ']')
            OR json_extract(i.data,'$.status') IN ('queued','capturing','running','saving')))
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
          sql: 'INSERT INTO digest_batch(id,created_at,data,owner) VALUES (?,?,?,?)',
          bind: [meta.id, meta.createdAt, JSON.stringify(meta), owner],
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
    case 'DB_DIGEST_RETRY':
      return db.transaction(() => {
        const { id } = request.payload;
        const batch = get(id);
        for (const item of batch.items.filter(retryableItem)) writeItem(id, restartItem(item));
        db.exec({
          sql: "UPDATE digest_batch SET data=json_remove(data,'$.error') WHERE id=?",
          bind: [id],
        });
        return get(id);
      });
    case 'DB_DIGEST_INTERRUPT':
      return db.transaction(() => {
        const { id, error } = request.payload;
        const active = get(id).items.filter(activeItem);
        for (const item of active) writeItem(id, interruptItem(item, error));
        if (active.length)
          db.exec({
            sql: "UPDATE digest_batch SET data=json_set(data,'$.error',?) WHERE id=?",
            bind: [error, id],
          });
        return get(id);
      });
    case 'DB_DIGEST_ACTION_REVISIONS':
      return db
        .selectObjects(
          "SELECT DISTINCT json_extract(data,'$.action.revision.revision') AS revision FROM digest_batch WHERE json_extract(data,'$.action.revision.revision') IS NOT NULL",
        )
        .map((r) => String(r.revision));
    case 'DB_DIGEST_LIST': {
      const visibleItem =
        visibility === 'visible' ? `${itemMask('di.batch_id', 'di.position')} IS NULL` : '1';
      return db
        .selectObjects(
          `SELECT b.id, b.created_at, ${batchMask('b.id')} AS masked_at,
             json_extract(b.data, '$.windowTitle') AS window_title,
             json_extract(i.data, '$.title') AS page_title,
             json_extract(i.data, '$.url') AS page_url,
             (SELECT count(*) FROM digest_item di WHERE di.batch_id=b.id AND ${visibleItem}) AS item_count
           FROM digest_batch b LEFT JOIN digest_item i ON i.batch_id=b.id
             AND i.position=(SELECT min(position) FROM digest_item di WHERE di.batch_id=b.id AND ${visibleItem})
           WHERE ${maskFilter(batchMask('b.id'), visibility)} ORDER BY b.created_at DESC,b.id DESC`,
        )
        .map((r) => ({
          id: String(r.id),
          createdAt: Number(r.created_at),
          windowTitle: String(r.window_title ?? ''),
          ...(r.masked_at != null ? { maskedAt: Number(r.masked_at) } : {}),
          title: summaryTitle(
            { title: String(r.page_title ?? ''), url: String(r.page_url ?? '') },
            Number(r.item_count),
          ),
        }));
    }
    case 'DB_DIGEST_ITEMS_PAGE': {
      const { id, limit = 25, cursor } = request.payload;
      const pagination = historyCursor([owner, 'calls.items', id, visibility], cursor);
      const after = pagination.read() ?? -1;
      const pageSize = Math.max(1, Math.min(100, limit));
      const rows = db.selectObjects(
        `SELECT data,position,${itemVisibility} AS masked_at
          FROM digest_item WHERE batch_id=? AND position>? AND ${maskFilter(itemVisibility, visibility)}
          ORDER BY position LIMIT ?`,
        [id, after, pageSize + 1],
      );
      const next = rows.length > pageSize;
      if (next) rows.pop();
      return {
        items: rows.map(projectItem),
        ...(next ? { cursor: pagination.write(Number(rows.at(-1)!.position)) } : {}),
      };
    }
    case 'DB_DIGEST_ITEM': {
      const { id, item, source } = request.payload;
      writeItem(id, item, source);
      return;
    }
    case 'DB_DIGEST_SOURCE': {
      const row = db.selectObject(
        `SELECT source FROM digest_item WHERE batch_id=? AND position=? AND ${maskFilter(itemVisibility, visibility)}`,
        [request.payload.id, request.payload.index],
      );
      return row?.source ? (JSON.parse(String(row.source)) as DigestSource) : undefined;
    }
    case 'DB_DIGEST_RECOVER':
      db.transaction(() => {
        for (const row of db.selectObjects(
          "SELECT i.batch_id,i.position,i.data FROM digest_item i JOIN digest_batch b ON b.id=i.batch_id WHERE b.owner=? OR b.owner=''",
          [owner],
        )) {
          const item = JSON.parse(String(row.data)) as DigestItem;
          if (!activeItem(item)) continue;
          writeItem(
            String(row.batch_id),
            interruptItem(
              item,
              'Interrupted when Saul restarted. Retry unfinished tabs explicitly.',
            ),
          );
        }
      });
      return;
  }
}
