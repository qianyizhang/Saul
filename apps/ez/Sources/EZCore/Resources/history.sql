-- Shared history schema, version 3. Applied once inside a SQLite transaction.

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

ALTER TABLE selection ADD COLUMN anchor_exact TEXT;
ALTER TABLE selection ADD COLUMN anchor_key TEXT;
ALTER TABLE llm_run ADD COLUMN submission_id TEXT;
ALTER TABLE llm_run ADD COLUMN input_json TEXT;
ALTER TABLE llm_run ADD COLUMN viewed_at INTEGER;
ALTER TABLE llm_run ADD COLUMN reason TEXT;
ALTER TABLE llm_run ADD COLUMN owner TEXT NOT NULL DEFAULT '';
ALTER TABLE llm_run ADD COLUMN transition_id TEXT;
CREATE TABLE submission (id TEXT PRIMARY KEY, selection_id TEXT REFERENCES selection(id) ON DELETE SET NULL, operation_id TEXT);
CREATE UNIQUE INDEX run_submission ON llm_run(submission_id);
CREATE INDEX selection_page ON selection(page_id);
CREATE UNIQUE INDEX selection_anchor ON selection(page_id, anchor_key);
CREATE INDEX selection_recent ON selection(created_at DESC, id DESC);
CREATE INDEX run_latest ON llm_run(selection_id, created_at DESC);
CREATE INDEX run_success ON llm_run(selection_id, created_at DESC) WHERE status = 'completed';
CREATE INDEX run_unread ON llm_run(status, viewed_at, selection_id);
CREATE TABLE digest_batch (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE digest_item (batch_id TEXT NOT NULL REFERENCES digest_batch(id) ON DELETE CASCADE, position INTEGER NOT NULL, data TEXT NOT NULL, source TEXT, PRIMARY KEY(batch_id,position));
ALTER TABLE digest_batch ADD COLUMN owner TEXT NOT NULL DEFAULT '';
CREATE TABLE ez_entry (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), image BLOB, input_image BLOB, bookmarked INTEGER NOT NULL DEFAULT 0);
CREATE INDEX ez_recent ON ez_entry(created_at DESC,id DESC);
CREATE TABLE history_migration (id TEXT PRIMARY KEY);
