import {
  upgradeNativeHistoryConnections,
  upgradeRunConnections,
} from '../../native/connection-migration.mts';
import { isRecord } from '../../native/value.mts';
import type { SqlDatabase } from './sql';

/** Called inside the schema transaction, before current history readers become available. */
export function upgradeHistoryConnections(db: SqlDatabase, native: boolean): void {
  for (const row of db.selectObjects(
    'SELECT id,input_json FROM llm_run WHERE input_json IS NOT NULL',
  )) {
    const input: unknown = JSON.parse(String(row.input_json));
    if (!isRecord(input)) throw new Error('Invalid stored run. Original history preserved.');
    db.exec({
      sql: 'UPDATE llm_run SET input_json=? WHERE id=?',
      bind: [JSON.stringify(upgradeRunConnections(input)), row.id!],
    });
  }
  for (const row of db.selectObjects('SELECT id,data FROM digest_batch')) {
    const value: unknown = JSON.parse(String(row.data));
    if (!isRecord(value)) throw new Error('Invalid stored summary. Original history preserved.');
    if (isRecord(value.action) && isRecord(value.action.input))
      value.action.input = upgradeRunConnections(value.action.input);
    db.exec({
      sql: 'UPDATE digest_batch SET data=? WHERE id=?',
      bind: [JSON.stringify(value), row.id!],
    });
  }
  if (native)
    for (const row of db.selectObjects('SELECT id,data FROM ez_entry')) {
      const value: unknown = JSON.parse(String(row.data));
      if (!isRecord(value)) throw new Error('Invalid stored lookup. Original history preserved.');
      db.exec({
        sql: 'UPDATE ez_entry SET data=? WHERE id=?',
        bind: [JSON.stringify(upgradeNativeHistoryConnections(value)), row.id!],
      });
    }
}
