export const INIT_SCHEMA_SQL = `
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
