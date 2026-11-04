import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  lstatSync,
  existsSync,
  unlinkSync,
  chmodSync,
} from 'node:fs';
import { secureDirectory } from './transport.mts';
import { SaulDatabase } from '../src/storage/db.ts';
import { searchableResponse } from '../src/storage/search.ts';
import { migrate } from '../src/storage/schema.ts';
import type { SqlDatabase, SqlValue } from '../src/storage/sql.ts';
import type { DbRequest } from '../src/types/storage.ts';
import type { HistoryRequest } from './history-protocol.mts';

export const historyDirectory = () =>
  join(homedir(), 'Library', 'Application Support', 'Little Clarity');
export class HistoryConnection implements SqlDatabase {
  readonly sqlite: DatabaseSync;
  private changed = 0;
  constructor(path: string) {
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;');
  }
  exec(command: string | { sql: string; bind?: SqlValue[] }) {
    if (typeof command === 'string') return this.sqlite.exec(command);
    this.changed = Number(
      this.sqlite.prepare(command.sql).run(...((command.bind || []) as SQLInputValue[])).changes,
    );
  }
  selectObjects(sql: string, bind: SqlValue[] = []) {
    return this.sqlite.prepare(sql).all(...(bind as SQLInputValue[])) as Record<string, SqlValue>[];
  }
  selectObject(sql: string, bind: SqlValue[] = []) {
    return this.selectObjects(sql, bind)[0];
  }
  selectValue(sql: string, bind: SqlValue[] = []) {
    const row = this.selectObject(sql, bind);
    return row && Object.values(row)[0];
  }
  changes() {
    return this.changed;
  }
  transaction<T>(operation: () => T): T {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.sqlite.exec('COMMIT');
      return result;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
  close() {
    this.sqlite.close();
  }
}
export class SharedHistory {
  readonly connection: HistoryConnection;
  readonly browser: SaulDatabase;
  private imports = new Map<string, { path: string; offset: number }>();
  readonly directory: string;
  constructor(directory = historyDirectory()) {
    this.directory = directory;
    secureDirectory(directory);
    const path = join(directory, 'history.sqlite3');
    if (existsSync(path) && (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()))
      throw new Error('History database must be a regular file.');
    this.connection = new HistoryConnection(path);
    chmodSync(path, 0o600);
    try {
      this.connection.transaction(() => {
        const version = Number(this.connection.selectValue('PRAGMA user_version'));
        if (version !== 0 && version !== 3) throw new Error('Unsupported shared history version.');
        if (!version) {
          this.connection.exec(readFileSync(new URL('./history.sql', import.meta.url), 'utf8'));
          this.connection.exec('PRAGMA user_version=3');
        }
      });
    } catch (error) {
      this.connection.close();
      throw error;
    }
    this.browser = new SaulDatabase(this.connection);
  }
  async run(request: HistoryRequest): Promise<unknown> {
    if (request.operation === 'db')
      return new SaulDatabase(this.connection, request.owner).execute(
        request.message as DbRequest,
        request.requestId,
      );
    const { id } = request;
    if (this.connection.selectValue('SELECT id FROM history_migration WHERE id=?', [id]))
      return { imported: true };
    if (request.operation === 'import-begin') {
      this.discard(id);
      const path = join(this.directory, `.history-import-${id}`);
      if (existsSync(path)) {
        const info = lstatSync(path);
        if (!info.isFile() || info.isSymbolicLink())
          throw new Error('Invalid interrupted history import.');
        unlinkSync(path);
      }
      writeFileSync(path, new Uint8Array(), { flag: 'wx', mode: 0o600 });
      this.imports.set(id, { path, offset: 0 });
      return { imported: false };
    }
    const state = this.imports.get(id);
    if (!state) throw new Error('History migration was interrupted. Reopen History to retry.');
    if (request.operation === 'import-chunk') {
      const bytes = Buffer.from(request.data, 'base64');
      if (state.offset !== request.offset || state.offset + bytes.length > 1024 * 1024 * 1024)
        throw new Error('Invalid history import offset or size.');
      appendFileSync(state.path, bytes);
      state.offset += bytes.length;
      return {};
    }
    if (state.offset !== request.size) {
      this.discard(id);
      throw new Error('History import is incomplete.');
    }
    if (!state.offset) {
      this.connection.exec({ sql: 'INSERT INTO history_migration VALUES (?)', bind: [id] });
      this.discard(id);
      return { imported: true };
    }
    let source: HistoryConnection | undefined;
    try {
      source = new HistoryConnection(state.path);
      if (source.selectValue('PRAGMA integrity_check') !== 'ok')
        throw new Error('Original history failed SQLite integrity verification.');
      migrate(source);
      const original = source;
      this.connection.transaction(() => {
        const pageMap = new Map<string, string>();
        for (const row of original.selectObjects('SELECT * FROM page')) {
          const prior = this.connection.selectObject('SELECT id FROM page WHERE url=?', [row.url!]);
          if (prior) pageMap.set(String(row.id), String(prior.id));
          else this.insert('page', row);
        }
        for (const table of [
          'selection',
          'llm_run',
          'interaction',
          'bookmark',
          'submission',
          'digest_batch',
          'digest_item',
        ]) {
          const rows = original.selectObjects(`SELECT * FROM ${table}`);
          for (const row of rows) {
            if (table === 'selection')
              row.page_id = pageMap.get(String(row.page_id)) || row.page_id!;
            this.insert(table, row);
            const keys =
              table === 'bookmark'
                ? ['selection_id']
                : table === 'digest_item'
                  ? ['batch_id', 'position']
                  : ['id'];
            const saved = this.connection.selectObject(
              `SELECT * FROM ${table} WHERE ${keys.map((k) => `${k}=?`).join(' AND ')}`,
              keys.map((k) => row[k]!),
            );
            if (!saved || Object.entries(row).some(([key, value]) => saved[key] !== value))
              throw new Error(
                'History migration found conflicting records. Original history was retained.',
              );
          }
        }
        this.connection.exec('DELETE FROM explanation_fts;');
        for (const row of this.connection.selectObjects('SELECT rowid,response_raw FROM llm_run'))
          this.connection.exec({
            sql: 'INSERT INTO explanation_fts(rowid,body) VALUES (?,?)',
            bind: [row.rowid!, searchableResponse(String(row.response_raw || ''))],
          });
        if (this.connection.selectObjects('PRAGMA foreign_key_check').length)
          throw new Error('Imported history failed foreign-key verification.');
        this.connection.exec({ sql: 'INSERT INTO history_migration VALUES (?)', bind: [id] });
      });
      return { imported: true };
    } finally {
      source?.close();
      this.discard(id);
    }
  }
  private insert(table: string, row: Record<string, SqlValue>) {
    const keys = Object.keys(row);
    // Both table and column names come exclusively from the fixed source schema.
    this.connection.exec({
      sql: `INSERT OR IGNORE INTO ${table} (${keys.map((k) => `"${k.replaceAll('"', '""')}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
      bind: keys.map((k) => row[k]!),
    });
  }
  private discard(id: string) {
    const state = this.imports.get(id);
    if (state) {
      if (existsSync(state.path)) unlinkSync(state.path);
      this.imports.delete(id);
    }
  }
  close() {
    for (const id of this.imports.keys()) this.discard(id);
    this.connection.close();
  }
}
