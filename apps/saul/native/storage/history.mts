import { upgradeHistoryConnections } from './connection-upgrade.ts';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, lstatSync, existsSync, chmodSync } from 'node:fs';
import { secureDirectory } from '../transport.mts';
import type { SqlDatabase, SqlValue } from './sql.ts';
import { HistoryRepository } from './history-repository.mts';
import { validateHistoryRequest } from '../../shared/protocol/history-protocol.mts';

// Freeze the schema with this loaded runtime, including during later checkout builds.
const historySchema = readFileSync(new URL('./history.sql', import.meta.url), 'utf8');

export function initializeHistorySchema(connection: SqlDatabase): void {
  connection.transaction(() => {
    const version = Number(connection.selectValue('PRAGMA user_version'));
    if (version === 5) return;
    if (version !== 0 && version !== 3 && version !== 4)
      throw new Error('Unsupported shared history version.');
    const [initial, upgradeAndShared] = historySchema.split('\n-- Migrate v4 to v5\n');
    const [upgrade, shared] = upgradeAndShared?.split('\n-- Shared history v5\n') ?? [];
    if (!initial || !upgrade || !shared) throw new Error('Incomplete shared history schema.');
    if (version === 3) upgradeHistoryConnections(connection, true);
    connection.exec(version === 0 ? initial : upgrade);
    connection.exec(shared);
    connection.exec('PRAGMA user_version=5');
  });
}

export const historyDirectory = () =>
  join(homedir(), 'Library', 'Application Support', 'Little Clarity');
export class HistoryConnection implements SqlDatabase {
  readonly sqlite: DatabaseSync;
  private changed = 0;
  private transactionDepth = 0;
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
  transaction<T>(operation: () => T, mode: 'deferred' | 'immediate' = 'immediate'): T {
    const depth = this.transactionDepth;
    const nested = depth > 0;
    const savepoint = `history_${depth}`;
    this.sqlite.exec(nested ? `SAVEPOINT ${savepoint}` : `BEGIN ${mode.toUpperCase()}`);
    this.transactionDepth++;
    try {
      const result = operation();
      this.sqlite.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
      return result;
    } catch (error) {
      this.sqlite.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK');
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }
  close() {
    this.sqlite.close();
  }
}
export class SharedHistory {
  readonly connection: HistoryConnection;
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
      initializeHistorySchema(this.connection);
    } catch (error) {
      this.connection.close();
      throw error;
    }
  }
  async run(request: unknown) {
    validateHistoryRequest(request);
    return new HistoryRepository(this.connection).run(request);
  }
  close() {
    this.connection.close();
  }
}
