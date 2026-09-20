// Compiled only into disposable test extension snapshots, never shipped.
import sqlite3InitModule, { type Database } from '@sqlite.org/sqlite-wasm';
import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url';
import { SaulDatabase } from '../../src/storage/db';
import { migrate } from '../../src/storage/schema';
import type { DbRequest } from '../../src/types/storage';

const repository = new SaulDatabase();
async function rawDatabase() {
  await repository.init();
  return (repository as unknown as { db: Database }).db;
}
const baseline = `SELECT s.id,s.text,r.response_raw FROM selection s LEFT JOIN llm_run r ON r.rowid=(SELECT rowid FROM llm_run WHERE selection_id=s.id ORDER BY created_at DESC,rowid DESC LIMIT 1) ORDER BY s.created_at DESC,s.id DESC LIMIT 50`;
async function measure() {
  const db = await rawDatabase();
  const times = async (fn: () => unknown | Promise<unknown>, repeats = 5) => {
    const values: number[] = [];
    for (let i = 0; i < repeats; i++) {
      const start = performance.now();
      await fn();
      values.push(performance.now() - start);
    }
    return {
      samplesMs: values,
      medianMs: [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)],
    };
  };
  const report: Record<string, unknown> = {
    rows: db.selectObjects(
      'SELECT (SELECT count(*) FROM selection) selections,(SELECT count(*) FROM llm_run) runs',
    ),
    sqlite: db.selectValue('SELECT sqlite_version()'),
  };
  report.history = await times(() =>
    repository.execute({ type: 'DB_GET_HISTORY', payload: { limit: 50 } }),
  );
  report.historyOffset = await times(() =>
    repository.execute({ type: 'DB_GET_HISTORY', payload: { limit: 50, offset: 9000 } }),
  );
  report.page = await times(() =>
    repository.execute({ type: 'DB_PAGE', payload: { url: 'https://scale.test/page-0' } }),
  );
  report.search = await times(
    () =>
      repository.execute({
        type: 'DB_GET_HISTORY',
        payload: { searchQuery: 'gradient', limit: 50 },
      }),
    3,
  );
  report.export = await times(
    () => repository.execute({ type: 'DB_EXPORT_MARKDOWN', payload: undefined }),
    1,
  );
  report.plan = db.selectObjects('EXPLAIN QUERY PLAN ' + baseline);
  // Compare the previous history SQL with and without the newly added indexes.
  report.previousQueryWithIndexes = await times(() => db.selectObjects(baseline), 3);
  db.exec(
    'DROP INDEX run_latest; DROP INDEX run_success; DROP INDEX selection_recent; DROP INDEX selection_page;',
  );
  report.previousPlan = db.selectObjects('EXPLAIN QUERY PLAN ' + baseline);
  report.previousQueryWithoutIndexes = await times(() => db.selectObjects(baseline), 1);
  db.exec(
    "CREATE INDEX run_latest ON llm_run(selection_id,created_at DESC); CREATE INDEX run_success ON llm_run(selection_id,created_at DESC) WHERE status='completed'; CREATE INDEX selection_recent ON selection(created_at DESC,id DESC); CREATE INDEX selection_page ON selection(page_id);",
  );
  return report;
}
async function scale(runs: number) {
  const db = await rawDatabase();
  db.transaction(() => {
    db.exec('DELETE FROM interaction; DELETE FROM page; DELETE FROM submission;');
    for (let page = 0; page < 100; page++)
      db.exec({
        sql: 'INSERT INTO page(id,url,title,first_seen_at,last_seen_at) VALUES (?,?,?,1,1)',
        bind: [`p${page}`, `https://scale.test/page-${page}`, 'Scale fixture'],
      });
    for (let i = 0; i < 10000; i++)
      db.exec({
        sql: 'INSERT INTO selection(id,page_id,text,prefix,suffix,created_at) VALUES (?,?,?,?,?,?)',
        bind: [`s${i}`, `p${i % 100}`, `Gradient ${i}`, 'before ', ' after', i + 1],
      });
    for (let i = 0; i < runs; i++)
      db.exec({
        sql: "INSERT INTO llm_run(id,selection_id,widget_id,provider,model,prompt_version,prompt_raw,context_json,response_raw,status,created_at,viewed_at) VALUES (?,?,'explain','openai-compatible','fixture','2','test','{}',?,'completed',?,?)",
        bind: [
          `r${i}`,
          `s${i % 10000}`,
          'A gradient points toward steepest increase. '.repeat(8),
          i + 1,
          i + 1,
        ],
      });
    db.exec('INSERT INTO explanation_fts(rowid,body) SELECT rowid,response_raw FROM llm_run');
  });
  return measure();
}
async function migrationChecks(legacy: string) {
  const sqlite = await (
    sqlite3InitModule as unknown as (o: unknown) => ReturnType<typeof sqlite3InitModule>
  )({ locateFile: () => wasmUrl });
  const db = new sqlite.oo1.DB(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON');
    db.exec(legacy);
    db.exec(`INSERT INTO page VALUES ('p','https://legacy.test','https://canonical.test','Old title',1,2);
 INSERT INTO selection(id,page_id,text,prefix,suffix,created_at) VALUES ('s','p','gradient','before ',' after',3);
 INSERT INTO llm_run(id,selection_id,widget_id,provider,model,prompt_version,prompt_raw,context_json,response_raw,status,created_at) VALUES ('r','s','explain','openai-compatible','old','1','original','{}','A <term note="Slope">gradient</term>.','completed',4);
 INSERT INTO bookmark VALUES ('s',5);`);
    // A real conflicting DDL statement fails midway through the migration.
    db.exec('CREATE INDEX run_latest ON llm_run(model)');
    let failed = false;
    try {
      migrate(db);
    } catch {
      failed = true;
    }
    const rollback = {
      failed,
      version: db.selectValue('PRAGMA user_version'),
      columns: db.selectObjects('PRAGMA table_info(llm_run)').map((r) => r.name),
      original: db.selectValue('SELECT response_raw FROM llm_run'),
      bookmark: db.selectValue('SELECT count(*) FROM bookmark'),
    };
    db.exec('DROP INDEX run_latest');
    migrate(db);
    migrate(db);
    const upgraded = {
      version: db.selectValue('PRAGMA user_version'),
      response: db.selectValue('SELECT response_raw FROM llm_run'),
      viewed: db.selectValue('SELECT viewed_at FROM llm_run'),
      bookmark: db.selectValue('SELECT count(*) FROM bookmark'),
      search: db.selectValue(
        "SELECT count(*) FROM explanation_fts WHERE explanation_fts MATCH 'Slope'",
      ),
    };
    db.exec('PRAGMA user_version=99');
    let rejected = false;
    try {
      migrate(db);
    } catch {
      rejected = true;
    }
    return { rollback, upgraded, rejected };
  } finally {
    db.close();
  }
}
self.onmessage = async ({
  data,
}: MessageEvent<{
  action: 'scale' | 'migrate' | 'db';
  runs?: number;
  legacy?: string;
  message?: DbRequest;
}>) => {
  try {
    const result =
      data.action === 'scale'
        ? await scale(data.runs!)
        : data.action === 'migrate'
          ? await migrationChecks(data.legacy!)
          : await repository.execute(data.message!);
    self.postMessage({ success: true, result });
  } catch (e) {
    self.postMessage({ success: false, error: String(e) });
  }
};
