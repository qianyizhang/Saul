import { executeHistory } from './helpers/history-db';
import type { SqlDatabase } from '../native/storage/sql.ts';
type FixtureStore = {
  connection: SqlDatabase;
  run(request: unknown): Promise<{ value: unknown }>;
};
import { searchableResponse } from '../native/storage/search.ts';
import type { RunInput } from '../shared/protocol/history-types.ts';
import type { DatabaseFixtureRequest, HistorySeed } from './e2e/database-harness';
async function seedHistory(repository: FixtureStore, { origin, count, options }: HistorySeed) {
  const db = repository.connection;
  if (Number(db.selectValue('SELECT count(*) FROM selection')) !== 0)
    throw new Error('History seeding requires a fresh fixture database.');
  const raw =
    options.response || 'A <term note="Steepest increase">gradient</term> explains velocity.';
  // This prepares persisted fixture data, not a submission/lifecycle test.
  // One transaction avoids thousands of individual SQLite commits.
  db.transaction(() => {
    db.exec({
      sql: 'INSERT INTO page(id,url,title,first_seen_at,last_seen_at) VALUES (?,?,?,1,1)',
      bind: ['seed-page', origin + '/article', options.title || 'Calculus notes'],
    });
    for (let i = 0; i < count; i++) {
      const id = `${options.prefix || 'item'}-${i}`;
      const text = `Selection ${id}`;
      const input = {
        provider: 'openai-compatible',
        remote: { baseUrl: origin + '/v1', model: 'test-model', temperature: 0.3 },
        local: { temperature: 0.3, topK: 3 },
        systemPrompt: 'test',
        userPrompt: 'test',
        context: { selection: text, pageTitle: '', pageUrl: '' },
      } satisfies RunInput;
      db.exec({
        sql: "INSERT INTO selection(id,page_id,text,prefix,suffix,text_start,text_end,created_at,anchor_exact) VALUES (?,'seed-page',?,'','',?,?,?,?)",
        bind: [id, text, i, i + text.length, i + 1, text],
      });
      db.exec({
        sql: "INSERT INTO llm_run(id,selection_id,widget_id,provider,model,prompt_version,prompt_raw,context_json,input_json,response_raw,latency_ms,status,created_at,viewed_at,submission_id) VALUES (?,?,'explain','openai-compatible','test-model','2','test',?,?,?,1,'completed',?,?,?)",
        bind: [id, id, JSON.stringify(input.context), JSON.stringify(input), raw, i + 1, i + 1, id],
      });
      db.exec({ sql: 'INSERT INTO submission(id,selection_id) VALUES (?,?)', bind: [id, id] });
      db.exec({
        sql: 'INSERT INTO explanation_fts(rowid,body) SELECT rowid,? FROM llm_run WHERE id=?',
        bind: [searchableResponse(raw), id],
      });
    }
  });
  return {
    selections: Number(db.selectValue('SELECT count(*) FROM selection')),
    completed: Number(db.selectValue("SELECT count(*) FROM llm_run WHERE status='completed'")),
  };
}
const baseline = `SELECT s.id,s.text,r.response_raw FROM selection s LEFT JOIN llm_run r ON r.rowid=(SELECT rowid FROM llm_run WHERE selection_id=s.id ORDER BY created_at DESC,rowid DESC LIMIT 1) ORDER BY s.created_at DESC,s.id DESC LIMIT 50`;
async function measure(repository: FixtureStore) {
  const db = repository.connection;
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
    executeHistory(repository, { type: 'DB_GET_HISTORY', payload: { limit: 50 } }),
  );
  report.historyOffset = await times(() =>
    executeHistory(repository, { type: 'DB_GET_HISTORY', payload: { limit: 50, offset: 9000 } }),
  );
  report.page = await times(() =>
    executeHistory(repository, { type: 'DB_PAGE', payload: { url: 'https://scale.test/page-0' } }),
  );
  report.search = await times(
    () =>
      executeHistory(repository, {
        type: 'DB_GET_HISTORY',
        payload: { searchQuery: 'gradient', limit: 50 },
      }),
    3,
  );
  report.export = await times(
    () => executeHistory(repository, { type: 'DB_EXPORT_MARKDOWN', payload: undefined }),
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
async function scale(repository: FixtureStore, runs: number) {
  const db = repository.connection;
  db.transaction(() => {
    db.exec('DELETE FROM page; DELETE FROM submission;');
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
  return measure(repository);
}
export async function runHistoryFixture(
  repository: FixtureStore,
  data: DatabaseFixtureRequest,
): Promise<unknown> {
  if (data.action === 'seed-native') {
    const id = '11111111-2222-3333-4444-555555555555';
    const entry = {
      schemaVersion: 1,
      id,
      createdAt: '2026-11-04T00:00:00Z',
      mode: 'Ask',
      query: 'Frozen native prompt',
      instructions: 'Frozen native instructions',
      response: 'Shared native answer 你好',
      model: 'native-model',
      effort: 'low',
      status: 'completed',
      inputValues: { text: 'Shared native input' },
      recipeSnapshot: { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'Native action' },
    };
    repository.connection.exec({
      sql: 'INSERT INTO ez_entry(id,created_at,data) VALUES (?,?,?)',
      bind: [id, Date.now(), JSON.stringify(entry)],
    });
    return id;
  }
  return data.action === 'scale'
    ? scale(repository, data.runs!)
    : data.action === 'seed-history'
      ? seedHistory(repository, data.seed)
      : executeHistory(repository, data.message);
}
