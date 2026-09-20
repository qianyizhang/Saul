import type { Database } from '@sqlite.org/sqlite-wasm';
import { TagStreamParser } from '../parser/tag-stream-parser';

const LEGACY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS page (
    id              TEXT PRIMARY KEY,
    url             TEXT NOT NULL UNIQUE,
    canonical_url   TEXT,
    title           TEXT,
    first_seen_at   INTEGER NOT NULL,
    last_seen_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS selection (
    id              TEXT PRIMARY KEY,
    page_id         TEXT NOT NULL REFERENCES page(id) ON DELETE CASCADE,
    text            TEXT NOT NULL,
    prefix          TEXT,
    suffix          TEXT,
    text_start      INTEGER,
    text_end        INTEGER,
    dom_path        TEXT,
    rect_json       TEXT,
    created_at      INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS selection_fts USING fts5(
    text,
    content='selection',
    content_rowid='rowid'
);

CREATE TABLE IF NOT EXISTS llm_run (
    id                  TEXT PRIMARY KEY,
    selection_id        TEXT NOT NULL REFERENCES selection(id) ON DELETE CASCADE,
    widget_id           TEXT NOT NULL,
    provider            TEXT NOT NULL,
    model               TEXT NOT NULL,
    prompt_version      TEXT NOT NULL,
    prompt_raw          TEXT NOT NULL,
    context_json        TEXT NOT NULL,
    response_raw        TEXT,
    response_structured TEXT,
    input_tokens        INTEGER,
    output_tokens       INTEGER,
    latency_ms          INTEGER,
    status              TEXT NOT NULL,
    error_message       TEXT,
    created_at          INTEGER NOT NULL
);

-- Replace the legacy raw-markup index with readable text and concept notes.
DROP TRIGGER IF EXISTS llm_run_ai;
DROP TRIGGER IF EXISTS llm_run_ad;
DROP TABLE IF EXISTS llm_run_fts;
CREATE VIRTUAL TABLE IF NOT EXISTS explanation_fts USING fts5(body);

CREATE TABLE IF NOT EXISTS interaction (
    id              TEXT PRIMARY KEY,
    selection_id    TEXT REFERENCES selection(id) ON DELETE SET NULL,
    llm_run_id      TEXT REFERENCES llm_run(id) ON DELETE SET NULL,
    event_type      TEXT NOT NULL,
    event_data      TEXT,
    created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bookmark (
    selection_id TEXT PRIMARY KEY REFERENCES selection(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
);

-- Triggers to keep FTS tables synced with primary tables
CREATE TRIGGER IF NOT EXISTS selection_ai AFTER INSERT ON selection BEGIN
  INSERT INTO selection_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TRIGGER IF NOT EXISTS selection_ad AFTER DELETE ON selection BEGIN
  INSERT INTO selection_fts(selection_fts, rowid, text) VALUES('delete', old.rowid, old.text);
END;

CREATE TRIGGER IF NOT EXISTS explanation_ad AFTER DELETE ON llm_run BEGIN
  DELETE FROM explanation_fts WHERE rowid = old.rowid;
END;
`;

export const SCHEMA_VERSION = 1;

export function migrate(db: Database): void {
  const version = Number(db.selectValue('PRAGMA user_version') || 0);
  if (version > SCHEMA_VERSION)
    throw new Error(
      `Database version ${version} is newer than this Saul release. Downgrades are unsupported.`,
    );
  if (version === SCHEMA_VERSION) return;
  // The unversioned release is version 0. DDL, backfill, and version advance
  // share one transaction; a failed upgrade leaves the original database intact.
  db.transaction(() => {
    db.exec(LEGACY_SCHEMA_SQL);
    db.exec(`
      ALTER TABLE selection ADD COLUMN anchor_exact TEXT;
      ALTER TABLE selection ADD COLUMN anchor_key TEXT;
      ALTER TABLE llm_run ADD COLUMN submission_id TEXT;
      ALTER TABLE llm_run ADD COLUMN input_json TEXT;
      ALTER TABLE llm_run ADD COLUMN viewed_at INTEGER;
      ALTER TABLE llm_run ADD COLUMN reason TEXT;
      CREATE TABLE submission (id TEXT PRIMARY KEY, selection_id TEXT REFERENCES selection(id) ON DELETE SET NULL);
      CREATE UNIQUE INDEX run_submission ON llm_run(submission_id);
      CREATE INDEX selection_page ON selection(page_id);
      CREATE UNIQUE INDEX selection_anchor ON selection(page_id, anchor_key);
      CREATE INDEX selection_recent ON selection(created_at DESC, id DESC);
      CREATE INDEX run_latest ON llm_run(selection_id, created_at DESC);
      CREATE INDEX run_success ON llm_run(selection_id, created_at DESC) WHERE status = 'completed';
      CREATE INDEX run_unread ON llm_run(status, viewed_at, selection_id);
      UPDATE llm_run SET viewed_at = created_at WHERE status = 'completed';
      UPDATE llm_run SET status = 'interrupted', reason = 'upgrade', error_message = 'Interrupted before upgrade. Retry explicitly.' WHERE status IN ('running', 'aborted');
    `);
    db.exec({
      sql: 'SELECT rowid, response_raw FROM llm_run WHERE rowid NOT IN (SELECT rowid FROM explanation_fts)',
      rowMode: 'object',
      callback: (row) => {
        db.exec({
          sql: 'INSERT INTO explanation_fts(rowid, body) VALUES (?, ?)',
          bind: [row.rowid, searchableResponse(String(row.response_raw || ''))],
        });
      },
    });
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  });
}

export function searchableResponse(raw: string): string {
  return new TagStreamParser()
    .feed(raw)
    .map((s) => (s.type === 'text' ? s.text : s.term + ' ' + s.note))
    .join(' ');
}
