-- Shared history schema, version 5. Execute the appropriate sections in one transaction.

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
CREATE INDEX selection_anchor ON selection(page_id, anchor_key);
CREATE INDEX selection_recent ON selection(created_at DESC, id DESC);
CREATE INDEX run_latest ON llm_run(selection_id, created_at DESC);
CREATE INDEX run_success ON llm_run(selection_id, created_at DESC) WHERE status = 'completed';
CREATE INDEX run_unread ON llm_run(status, viewed_at, selection_id);
CREATE TABLE digest_batch (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE digest_item (batch_id TEXT NOT NULL REFERENCES digest_batch(id) ON DELETE CASCADE, position INTEGER NOT NULL, data TEXT NOT NULL, source TEXT, PRIMARY KEY(batch_id,position));
ALTER TABLE digest_batch ADD COLUMN owner TEXT NOT NULL DEFAULT '';
CREATE TABLE ez_entry (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), image BLOB, input_image BLOB, bookmarked INTEGER NOT NULL DEFAULT 0);
CREATE INDEX ez_recent ON ez_entry(created_at DESC,id DESC);
ALTER TABLE selection ADD COLUMN bookmarked_at INTEGER;

-- Migrate v4 to v5
ALTER TABLE selection ADD COLUMN bookmarked_at INTEGER;
UPDATE selection SET bookmarked_at=(SELECT created_at FROM bookmark WHERE selection_id=selection.id);
DROP TABLE bookmark;
DROP TABLE interaction;
DROP TABLE history_migration;
DROP INDEX selection_anchor;
CREATE INDEX selection_anchor ON selection(page_id, anchor_key);

-- Shared history v5
ALTER TABLE llm_run ADD COLUMN admission_source_id TEXT;
CREATE INDEX run_admission_source ON llm_run(selection_id,admission_source_id) WHERE admission_source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS browser_annotation (
    owner TEXT NOT NULL,
    id TEXT NOT NULL,
    url TEXT NOT NULL,
    deleted_at INTEGER,
    body TEXT NOT NULL,
    PRIMARY KEY(owner,id)
);
CREATE INDEX IF NOT EXISTS browser_annotation_page ON browser_annotation(owner,url);
CREATE TABLE IF NOT EXISTS browser_annotation_attempt (
    owner TEXT NOT NULL,
    id TEXT NOT NULL,
    annotation_id TEXT NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY(owner,id),
    FOREIGN KEY(owner,annotation_id) REFERENCES browser_annotation(owner,id) ON DELETE CASCADE
);

CREATE TABLE history_record (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    owner TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 1,
    masked_at INTEGER,
    PRIMARY KEY(collection,id,owner)
);
CREATE TABLE history_entry (
    collection TEXT NOT NULL,
    record_id TEXT NOT NULL,
    id TEXT NOT NULL,
    owner TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL,
    masked_at INTEGER,
    PRIMARY KEY(collection,record_id,id,owner),
    FOREIGN KEY(collection,record_id,owner) REFERENCES history_record(collection,id,owner) ON DELETE CASCADE
);
CREATE TABLE history_event (
    collection TEXT NOT NULL,
    record_id TEXT NOT NULL,
    owner TEXT NOT NULL DEFAULT '',
    sequence INTEGER NOT NULL,
    kind TEXT NOT NULL,
    entry_id TEXT,
    committed_at INTEGER NOT NULL,
    PRIMARY KEY(collection,record_id,owner,sequence),
    FOREIGN KEY(collection,record_id,owner) REFERENCES history_record(collection,id,owner) ON DELETE CASCADE
);
CREATE TABLE history_receipt (
    operation_id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    acknowledgement TEXT NOT NULL CHECK(json_valid(acknowledgement))
);
CREATE TABLE history_receipt_record (
    operation_id TEXT NOT NULL REFERENCES history_receipt(operation_id) ON DELETE CASCADE,
    collection TEXT NOT NULL,
    record_id TEXT NOT NULL,
    owner TEXT NOT NULL,
    PRIMARY KEY(operation_id,collection,record_id,owner)
);
CREATE INDEX history_receipt_by_record ON history_receipt_record(collection,record_id,owner);
CREATE TABLE history_tombstone (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    owner TEXT NOT NULL DEFAULT '',
    PRIMARY KEY(collection,id,owner)
);
CREATE TABLE history_entry_tombstone (
    collection TEXT NOT NULL,
    record_id TEXT NOT NULL,
    id TEXT NOT NULL,
    owner TEXT NOT NULL DEFAULT '',
    PRIMARY KEY(collection,record_id,id,owner)
);
CREATE INDEX history_record_expiry ON history_record(masked_at) WHERE masked_at IS NOT NULL;
CREATE INDEX history_entry_expiry ON history_entry(masked_at) WHERE masked_at IS NOT NULL;
CREATE INDEX history_entry_order ON history_entry(collection,record_id,owner,position,id);

-- Normalize only fields with a known legacy interpretation. A generated reply shares an
-- entry with its attempt only when its ID, author, status and saved text agree.
DELETE FROM ez_entry WHERE NOT COALESCE(
  json_extract(data,'$.schemaVersion')=1
  AND lower(json_extract(data,'$.id'))=id
  AND length(id)=36
  AND substr(id,9,1)='-' AND substr(id,14,1)='-' AND substr(id,19,1)='-' AND substr(id,24,1)='-'
  AND replace(id,'-','') NOT GLOB '*[^a-f0-9]*'
  AND julianday(json_extract(data,'$.createdAt')) IS NOT NULL
  AND json_extract(data,'$.mode') IN ('Ask','Dictionary','Spell Check')
  AND json_type(data,'$.query')='text' AND json_type(data,'$.response')='text'
  AND json_type(data,'$.model')='text' AND json_type(data,'$.effort')='text'
  AND json_type(data,'$.status')='text',0);
UPDATE llm_run SET input_json=NULL
  WHERE input_json IS NOT NULL AND NOT json_valid(input_json);
DELETE FROM digest_item WHERE NOT json_valid(data);
DELETE FROM digest_batch WHERE NOT json_valid(data);
DELETE FROM browser_annotation_attempt WHERE CASE WHEN json_valid(body) THEN
  NOT COALESCE(json_type(body)='object' AND json_extract(body,'$.id')=id
    AND json_extract(body,'$.annotationId')=annotation_id AND json_type(body,'$.status')='text',0)
  ELSE 1 END;
DELETE FROM browser_annotation WHERE CASE WHEN json_valid(body) THEN
  NOT COALESCE(json_type(body)='object' AND json_extract(body,'$.id')=id
    AND json_extract(body,'$.url')=url AND json_type(body,'$.revision')='integer',0)
  ELSE 1 END;
UPDATE browser_annotation AS a SET body=json_set(a.body,'$.replies',json((
  SELECT json_group_array(json(value)) FROM (
    SELECT CASE WHEN t.id IS NOT NULL
      THEN json_set(reply.value,'$.text','','$.generated',json('true'))
      ELSE reply.value END AS value
    FROM json_each(a.body,'$.replies') reply
    LEFT JOIN browser_annotation_attempt t
      ON t.owner=a.owner AND t.annotation_id=a.id
      AND t.id=json_extract(CASE WHEN reply.type='object' THEN reply.value ELSE '{}' END,'$.id')
    WHERE CASE WHEN reply.type='object' THEN
      json_type(reply.value,'$.id')='text' AND json_type(reply.value,'$.text')='text'
      AND json_type(reply.value,'$.author')='object'
      AND (t.id IS NULL OR (json_extract(t.body,'$.status')='completed'
        AND json_extract(reply.value,'$.author.kind')='call'
        AND json_extract(t.body,'$.raw')=json_extract(reply.value,'$.text')))
      ELSE 0 END
    ORDER BY CAST(reply.key AS INTEGER)
  )
))) WHERE COALESCE(json_type(a.body,'$.replies'),'')!='array' OR json_array_length(a.body,'$.replies')>0;
-- A conversion imports the known final state without inventing earlier events.
INSERT INTO history_record(collection,id) SELECT 'library-browser',id FROM selection;
INSERT INTO history_record(collection,id) SELECT 'library-native',id FROM ez_entry;
INSERT INTO history_record(collection,id) SELECT 'calls',id FROM digest_batch;
INSERT INTO history_record(collection,id,owner,revision,masked_at)
SELECT 'annotations',id,owner,COALESCE(json_extract(body,'$.revision'),1),deleted_at
FROM browser_annotation WHERE json_valid(body);
INSERT INTO history_entry(collection,record_id,id,position)
SELECT 'library-browser',selection_id,id,rowid FROM llm_run;
INSERT INTO history_entry(collection,record_id,id,position)
SELECT 'library-native',id,id,rowid FROM ez_entry;
INSERT INTO history_entry(collection,record_id,id,position)
SELECT 'calls',batch_id,CAST(position AS TEXT),position FROM digest_item;
INSERT INTO history_entry(collection,record_id,id,owner,position)
SELECT 'annotations',t.annotation_id,t.id,t.owner,t.rowid FROM browser_annotation_attempt t
JOIN history_record r ON r.collection='annotations' AND r.id=t.annotation_id AND r.owner=t.owner
WHERE json_valid(t.body);
INSERT OR IGNORE INTO history_entry(collection,record_id,id,owner,position)
SELECT 'annotations',a.id,json_extract(reply.value,'$.id'),a.owner,
  COALESCE((SELECT MAX(rowid) FROM browser_annotation_attempt),0)+CAST(reply.key AS INTEGER)+1
FROM browser_annotation a JOIN history_record r ON r.collection='annotations' AND r.id=a.id AND r.owner=a.owner
JOIN json_each(a.body,'$.replies') reply
WHERE reply.type='object' AND json_type(reply.value,'$.id')='text';

UPDATE history_entry AS e SET position=COALESCE((SELECT MAX(rowid) FROM browser_annotation_attempt),0)+(
  SELECT CAST(reply.key AS INTEGER)+1
  FROM browser_annotation a JOIN json_each(a.body,'$.replies') reply
  WHERE a.owner=e.owner AND a.id=e.record_id AND json_extract(reply.value,'$.id')=e.id
)
WHERE e.collection='annotations' AND EXISTS(
  SELECT 1 FROM browser_annotation a JOIN json_each(a.body,'$.replies') reply
  WHERE a.owner=e.owner AND a.id=e.record_id AND json_extract(reply.value,'$.id')=e.id
);

UPDATE history_record AS r SET revision=MAX(r.revision,COALESCE((
  SELECT MAX(position) FROM history_entry e
  WHERE e.collection=r.collection AND e.record_id=r.id AND e.owner=r.owner
),1)) WHERE r.collection IN ('library-browser','annotations');

-- All adapters observe the same revision and access guards, regardless of writer.
CREATE TRIGGER history_record_created AFTER INSERT ON history_record
BEGIN
  INSERT INTO history_event(collection,record_id,owner,sequence,kind,committed_at)
  VALUES(new.collection,new.id,new.owner,new.revision,'created',
    CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
END;
CREATE TRIGGER history_record_revision AFTER UPDATE OF revision ON history_record
WHEN new.revision > old.revision
BEGIN
  INSERT INTO history_event(collection,record_id,owner,sequence,kind,committed_at)
  VALUES(new.collection,new.id,new.owner,new.revision,
    CASE WHEN old.masked_at IS NULL AND new.masked_at IS NOT NULL THEN 'masked'
         WHEN old.masked_at IS NOT NULL AND new.masked_at IS NULL THEN 'restored'
         ELSE 'updated' END,
    CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
END;

CREATE TRIGGER history_entry_delete AFTER DELETE ON history_entry
BEGIN
  UPDATE history_receipt SET acknowledgement=json_set(acknowledgement,'$.value',NULL,'$.purged',1)
    WHERE operation_id IN (SELECT operation_id FROM history_receipt_record
      WHERE collection=old.collection AND record_id=old.record_id AND owner=old.owner);

  INSERT OR IGNORE INTO history_entry_tombstone VALUES(old.collection,old.record_id,old.id,old.owner);
END;

CREATE TRIGGER history_record_delete AFTER DELETE ON history_record
BEGIN
  UPDATE history_receipt SET acknowledgement=json_set(acknowledgement,'$.value',NULL,'$.purged',1)
    WHERE operation_id IN (SELECT operation_id FROM history_receipt_record
      WHERE collection=old.collection AND record_id=old.id AND owner=old.owner);
  DELETE FROM history_receipt_record WHERE collection=old.collection AND record_id=old.id AND owner=old.owner;
  INSERT OR IGNORE INTO history_tombstone VALUES(old.collection,old.id,old.owner);
  DELETE FROM history_entry_tombstone WHERE collection=old.collection AND record_id=old.id AND owner=old.owner;
END;

CREATE TRIGGER history_selection_before_insert BEFORE INSERT ON selection
WHEN EXISTS(SELECT 1 FROM history_tombstone WHERE collection='library-browser' AND id=new.id AND owner='')
BEGIN
  SELECT RAISE(ABORT, 'This history was permanently deleted.');
END;
CREATE TRIGGER history_selection_insert AFTER INSERT ON selection
BEGIN
  INSERT INTO history_record(collection,id,owner,revision,masked_at) VALUES('library-browser',new.id,'',1,NULL);
END;
CREATE TRIGGER history_selection_delete BEFORE DELETE ON selection
WHEN EXISTS(SELECT 1 FROM llm_run WHERE selection_id=old.id AND status IN ('queued','running','saving'))
BEGIN
  SELECT RAISE(ABORT, 'Stop active work before permanently deleting history.');
END;
CREATE TRIGGER history_selection_deleted AFTER DELETE ON selection
BEGIN
  DELETE FROM history_record WHERE collection='library-browser' AND id=old.id AND owner='';
END;
CREATE TRIGGER history_selection_update AFTER UPDATE ON selection
BEGIN
  UPDATE history_record SET revision=revision+1 WHERE collection='library-browser' AND id=new.id AND owner='';
END;

CREATE TRIGGER history_ez_entry_before_insert BEFORE INSERT ON ez_entry
WHEN EXISTS(SELECT 1 FROM history_tombstone WHERE collection='library-native' AND id=new.id AND owner='')
BEGIN
  SELECT RAISE(ABORT, 'This history was permanently deleted.');
END;
CREATE TRIGGER history_ez_entry_insert AFTER INSERT ON ez_entry
BEGIN
  INSERT INTO history_record(collection,id,owner,revision,masked_at) VALUES('library-native',new.id,'',1,NULL);
  INSERT INTO history_entry(collection,record_id,id,position) VALUES('library-native',new.id,new.id,new.rowid);
END;
CREATE TRIGGER history_ez_entry_delete BEFORE DELETE ON ez_entry
WHEN EXISTS(SELECT 1 FROM ez_entry e WHERE json_extract(e.data,'$.status')='pending'
  AND (e.id=old.id OR json_extract(e.data,'$.admissionSourceID')=old.id))
BEGIN
  SELECT RAISE(ABORT, 'Stop active work before permanently deleting history.');
END;
CREATE TRIGGER history_ez_entry_deleted AFTER DELETE ON ez_entry
BEGIN
  DELETE FROM history_record WHERE collection='library-native' AND id=old.id AND owner='';
END;
CREATE TRIGGER history_ez_entry_update AFTER UPDATE ON ez_entry
WHEN EXISTS(SELECT 1 FROM history_entry WHERE collection='library-native' AND record_id=new.id AND id=new.id AND owner='')
BEGIN
  UPDATE history_record SET revision=revision+1 WHERE collection='library-native' AND id=new.id AND owner='';
END;

CREATE TRIGGER history_digest_batch_before_insert BEFORE INSERT ON digest_batch
WHEN EXISTS(SELECT 1 FROM history_tombstone WHERE collection='calls' AND id=new.id AND owner='')
BEGIN
  SELECT RAISE(ABORT, 'This history was permanently deleted.');
END;
CREATE TRIGGER history_digest_batch_insert AFTER INSERT ON digest_batch
BEGIN
  INSERT INTO history_record(collection,id,owner,revision,masked_at) VALUES('calls',new.id,'',1,NULL);
END;
CREATE TRIGGER history_digest_batch_delete BEFORE DELETE ON digest_batch
WHEN EXISTS(SELECT 1 FROM digest_item WHERE batch_id=old.id AND json_extract(data,'$.status') IN ('queued','capturing','running','saving'))
BEGIN
  SELECT RAISE(ABORT, 'Stop active work before permanently deleting history.');
END;
CREATE TRIGGER history_digest_batch_deleted AFTER DELETE ON digest_batch
BEGIN
  DELETE FROM history_record WHERE collection='calls' AND id=old.id AND owner='';
END;
CREATE TRIGGER history_digest_batch_update AFTER UPDATE ON digest_batch
BEGIN
  UPDATE history_record SET revision=revision+1 WHERE collection='calls' AND id=new.id AND owner='';
END;

CREATE TRIGGER history_browser_annotation_before_insert BEFORE INSERT ON browser_annotation
WHEN EXISTS(SELECT 1 FROM history_tombstone WHERE collection='annotations' AND id=new.id AND owner=new.owner)
BEGIN
  SELECT RAISE(ABORT, 'This history was permanently deleted.');
END;
CREATE TRIGGER history_browser_annotation_insert AFTER INSERT ON browser_annotation
BEGIN
  INSERT INTO history_record(collection,id,owner,revision,masked_at) VALUES('annotations',new.id,new.owner,COALESCE(json_extract(new.body,'$.revision'),1),new.deleted_at);
END;
CREATE TRIGGER history_browser_annotation_delete BEFORE DELETE ON browser_annotation
WHEN EXISTS(SELECT 1 FROM browser_annotation_attempt WHERE owner=old.owner AND annotation_id=old.id AND json_extract(body,'$.status') IN ('queued','running','saving'))
BEGIN
  SELECT RAISE(ABORT, 'Stop active work before permanently deleting history.');
END;
CREATE TRIGGER history_browser_annotation_deleted AFTER DELETE ON browser_annotation
BEGIN
  DELETE FROM history_record WHERE collection='annotations' AND id=old.id AND owner=old.owner;
END;
CREATE TRIGGER history_browser_annotation_update AFTER UPDATE ON browser_annotation
BEGIN
  UPDATE history_record SET revision=revision+1,masked_at=new.deleted_at WHERE collection='annotations' AND id=new.id AND owner=new.owner;
END;

CREATE TRIGGER history_guard_browser_mask BEFORE UPDATE OF masked_at ON history_record
WHEN new.collection='library-browser' AND new.masked_at IS NOT NULL
  AND EXISTS(SELECT 1 FROM llm_run WHERE selection_id=new.id AND status IN ('queued','running','saving'))
BEGIN
  SELECT RAISE(ABORT, 'Stop the running request in Saul before deleting this history.');
END;
CREATE TRIGGER history_guard_native_mask BEFORE UPDATE OF masked_at ON history_record
WHEN new.collection='library-native' AND new.masked_at IS NOT NULL
  AND EXISTS(SELECT 1 FROM ez_entry e WHERE json_extract(e.data,'$.status')='pending'
    AND (e.id=new.id OR json_extract(e.data,'$.admissionSourceID')=new.id))
BEGIN
  SELECT RAISE(ABORT, 'Stop the running request in EZ before deleting this history.');
END;
CREATE TRIGGER history_guard_native_update BEFORE UPDATE OF data,image,input_image ON ez_entry
WHEN NOT (
  new.data='{}' AND new.image IS NULL AND new.input_image IS NULL AND NOT EXISTS(
    SELECT 1 FROM history_entry WHERE collection='library-native' AND record_id=old.id AND id=old.id AND owner=''
  )
) AND (
  EXISTS(SELECT 1 FROM history_record WHERE collection='library-native' AND id=old.id AND owner='' AND masked_at IS NOT NULL)
  OR NOT EXISTS(
    SELECT 1 FROM history_entry WHERE collection='library-native' AND record_id=old.id AND id=old.id AND owner='' AND masked_at IS NULL
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Restore this history before updating it.');
END;
CREATE TRIGGER history_guard_native_entry_mask BEFORE UPDATE OF masked_at ON history_entry
WHEN new.collection='library-native' AND new.masked_at IS NOT NULL
  AND EXISTS(SELECT 1 FROM ez_entry e WHERE json_extract(e.data,'$.status')='pending'
    AND (e.id=new.record_id OR json_extract(e.data,'$.admissionSourceID')=new.record_id))
BEGIN
  SELECT RAISE(ABORT, 'Stop the running request in EZ before deleting this history entry.');
END;
CREATE TRIGGER history_guard_native_entry_delete BEFORE DELETE ON history_entry
WHEN old.collection='library-native'
  AND EXISTS(SELECT 1 FROM ez_entry e WHERE json_extract(e.data,'$.status')='pending'
    AND (e.id=old.record_id OR json_extract(e.data,'$.admissionSourceID')=old.record_id))
BEGIN
  SELECT RAISE(ABORT, 'Stop the running request in EZ before permanently deleting this history entry.');
END;
CREATE TRIGGER history_native_entry_scrub AFTER DELETE ON history_entry
WHEN old.collection='library-native'
BEGIN
  UPDATE ez_entry SET data='{}',image=NULL,input_image=NULL,bookmarked=0 WHERE id=old.record_id;
END;
CREATE TRIGGER history_guard_calls_mask BEFORE UPDATE OF masked_at ON history_record
WHEN new.collection='calls' AND new.masked_at IS NOT NULL
  AND EXISTS(SELECT 1 FROM digest_item WHERE batch_id=new.id AND json_extract(data,'$.status') IN ('queued','capturing','running','saving'))
BEGIN
  SELECT RAISE(ABORT, 'Stop the active Call before deleting this history.');
END;
CREATE TRIGGER history_guard_annotation_mask BEFORE UPDATE OF masked_at ON history_record
WHEN new.collection='annotations' AND new.masked_at IS NOT NULL
  AND EXISTS(SELECT 1 FROM browser_annotation_attempt WHERE owner=new.owner AND annotation_id=new.id AND json_extract(body,'$.status') IN ('queued','running','saving'))
BEGIN
  SELECT RAISE(ABORT, 'Stop the active annotation request before deleting it.');
END;

CREATE TRIGGER history_llm_run_before_insert BEFORE INSERT ON llm_run
WHEN EXISTS(SELECT 1 FROM history_record WHERE collection='library-browser' AND id=new.selection_id AND owner='' AND masked_at IS NOT NULL)
  OR EXISTS(SELECT 1 FROM history_entry_tombstone WHERE collection='library-browser' AND record_id=new.selection_id AND id=CAST(new.id AS TEXT) AND owner='')
BEGIN
  SELECT RAISE(ABORT, 'History entry is unavailable.');
END;
CREATE TRIGGER history_llm_run_source_guard BEFORE INSERT ON llm_run
WHEN new.admission_source_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM history_entry e JOIN history_record r
    ON (r.collection,r.id,r.owner)=(e.collection,e.record_id,e.owner)
    WHERE e.collection='library-browser' AND e.record_id=new.selection_id AND e.owner=''
      AND e.id=new.admission_source_id AND e.masked_at IS NULL AND r.masked_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'The saved source changed or was deleted. Refresh it before submitting.');
END;
CREATE TRIGGER history_llm_run_insert AFTER INSERT ON llm_run
BEGIN
  INSERT INTO history_entry(collection,record_id,id,owner,position) SELECT 'library-browser',new.selection_id,new.id,'',revision+1 FROM history_record
    WHERE collection='library-browser' AND id=new.selection_id AND owner='';
  UPDATE history_record SET revision=revision+1 WHERE collection='library-browser' AND id=new.selection_id AND owner='';
  UPDATE history_event SET kind='entry-added', entry_id=CAST(new.id AS TEXT)
    WHERE collection='library-browser' AND record_id=new.selection_id AND owner=''
      AND sequence=(SELECT revision FROM history_record WHERE collection='library-browser' AND id=new.selection_id AND owner='');
END;
CREATE TRIGGER history_llm_run_delete BEFORE DELETE ON llm_run
WHEN EXISTS(
  SELECT 1 FROM llm_run active WHERE active.selection_id=old.selection_id
    AND (active.id=old.id OR active.admission_source_id=old.id)
    AND active.status IN ('queued','running','saving')
)
BEGIN
  SELECT RAISE(ABORT, 'Stop active work before permanently deleting history.');
END;
CREATE TRIGGER history_llm_run_deleted AFTER DELETE ON llm_run
BEGIN
  DELETE FROM history_entry WHERE collection='library-browser' AND record_id=old.selection_id AND id=CAST(old.id AS TEXT) AND owner='';
  UPDATE history_record SET revision=revision+1 WHERE collection='library-browser' AND id=old.selection_id AND owner='';
END;
CREATE TRIGGER history_llm_run_update AFTER UPDATE ON llm_run
WHEN new.status IS NOT old.status OR new.viewed_at IS NOT old.viewed_at
BEGIN
  UPDATE history_record SET revision=revision+1 WHERE collection='library-browser' AND id=new.selection_id AND owner='';
  UPDATE history_event SET kind='entry-updated', entry_id=CAST(new.id AS TEXT)
    WHERE collection='library-browser' AND record_id=new.selection_id AND owner=''
      AND sequence=(SELECT revision FROM history_record WHERE collection='library-browser' AND id=new.selection_id AND owner='');
END;
CREATE TRIGGER history_llm_run_entry_mask BEFORE UPDATE OF masked_at ON history_entry
WHEN new.collection='library-browser' AND new.masked_at IS NOT NULL
  AND EXISTS(
    SELECT 1 FROM llm_run active WHERE active.selection_id=new.record_id
      AND (active.id=new.id OR active.admission_source_id=new.id)
      AND active.status IN ('queued','running','saving')
  )
BEGIN
  SELECT RAISE(ABORT, 'Stop active work before deleting this history entry.');
END;

CREATE TRIGGER history_digest_item_before_insert BEFORE INSERT ON digest_item
WHEN EXISTS(SELECT 1 FROM history_record WHERE collection='calls' AND id=new.batch_id AND owner='' AND masked_at IS NOT NULL)
  OR EXISTS(SELECT 1 FROM history_entry_tombstone WHERE collection='calls' AND record_id=new.batch_id AND id=CAST(new.position AS TEXT) AND owner='')
BEGIN
  SELECT RAISE(ABORT, 'History entry is unavailable.');
END;
CREATE TRIGGER history_digest_item_insert AFTER INSERT ON digest_item
BEGIN
  INSERT INTO history_entry(collection,record_id,id,owner,position) VALUES('calls',new.batch_id,CAST(new.position AS TEXT),'',new.position);
  UPDATE history_record SET revision=revision+1 WHERE collection='calls' AND id=new.batch_id AND owner='';
  UPDATE history_event SET kind='entry-added', entry_id=CAST(new.position AS TEXT)
    WHERE collection='calls' AND record_id=new.batch_id AND owner=''
      AND sequence=(SELECT revision FROM history_record WHERE collection='calls' AND id=new.batch_id AND owner='');
END;
CREATE TRIGGER history_digest_item_delete BEFORE DELETE ON digest_item
WHEN json_extract(old.data,'$.status') IN ('queued','capturing','running','saving')
BEGIN
  SELECT RAISE(ABORT, 'Stop active work before permanently deleting history.');
END;
CREATE TRIGGER history_digest_item_deleted AFTER DELETE ON digest_item
BEGIN
  DELETE FROM history_entry WHERE collection='calls' AND record_id=old.batch_id AND id=CAST(old.position AS TEXT) AND owner='';
  UPDATE history_record SET revision=revision+1 WHERE collection='calls' AND id=old.batch_id AND owner='';
END;
CREATE TRIGGER history_digest_item_update AFTER UPDATE ON digest_item
WHEN json_extract(new.data,'$.status') IS NOT json_extract(old.data,'$.status')
  OR json_extract(new.data,'$.status') IN ('completed','failed','interrupted','cancelled','skipped')
BEGIN
  UPDATE history_record SET revision=revision+1 WHERE collection='calls' AND id=new.batch_id AND owner='';
  UPDATE history_event SET kind='entry-updated', entry_id=CAST(new.position AS TEXT)
    WHERE collection='calls' AND record_id=new.batch_id AND owner=''
      AND sequence=(SELECT revision FROM history_record WHERE collection='calls' AND id=new.batch_id AND owner='');
END;
CREATE TRIGGER history_digest_item_entry_mask BEFORE UPDATE OF masked_at ON history_entry
WHEN new.collection='calls' AND new.masked_at IS NOT NULL
  AND EXISTS(SELECT 1 FROM digest_item old WHERE old.batch_id=new.record_id AND CAST(old.position AS TEXT)=new.id AND (json_extract(old.data,'$.status') IN ('queued','capturing','running','saving')))
BEGIN
  SELECT RAISE(ABORT, 'Stop active work before deleting this history entry.');
END;

CREATE TRIGGER history_browser_annotation_attempt_before_insert BEFORE INSERT ON browser_annotation_attempt
WHEN EXISTS(SELECT 1 FROM history_record WHERE collection='annotations' AND id=new.annotation_id AND owner=new.owner AND masked_at IS NOT NULL)
  OR EXISTS(SELECT 1 FROM history_entry_tombstone WHERE collection='annotations' AND record_id=new.annotation_id AND id=CAST(new.id AS TEXT) AND owner=new.owner)
BEGIN
  SELECT RAISE(ABORT, 'History entry is unavailable.');
END;
CREATE TRIGGER history_browser_annotation_attempt_insert AFTER INSERT ON browser_annotation_attempt
BEGIN
  INSERT INTO history_entry(collection,record_id,id,owner,position) SELECT 'annotations',new.annotation_id,new.id,new.owner,revision+1 FROM history_record
    WHERE collection='annotations' AND id=new.annotation_id AND owner=new.owner;
  UPDATE history_record SET revision=revision+1 WHERE collection='annotations' AND id=new.annotation_id AND owner=new.owner;
  UPDATE history_event SET kind='entry-added', entry_id=CAST(new.id AS TEXT)
    WHERE collection='annotations' AND record_id=new.annotation_id AND owner=new.owner
      AND sequence=(SELECT revision FROM history_record WHERE collection='annotations' AND id=new.annotation_id AND owner=new.owner);
END;
CREATE TRIGGER history_browser_annotation_attempt_delete BEFORE DELETE ON browser_annotation_attempt
WHEN json_extract(old.body,'$.status') IN ('queued','running','saving')
BEGIN
  SELECT RAISE(ABORT, 'Stop active work before permanently deleting history.');
END;
CREATE TRIGGER history_browser_annotation_attempt_deleted AFTER DELETE ON browser_annotation_attempt
BEGIN
  DELETE FROM history_entry WHERE collection='annotations' AND record_id=old.annotation_id AND id=CAST(old.id AS TEXT) AND owner=old.owner;
  UPDATE history_record SET revision=revision+1 WHERE collection='annotations' AND id=old.annotation_id AND owner=old.owner;
END;
CREATE TRIGGER history_browser_annotation_attempt_update AFTER UPDATE ON browser_annotation_attempt
WHEN json_extract(new.body,'$.status') IS NOT json_extract(old.body,'$.status')
  OR json_extract(new.body,'$.status') IN ('completed','failed','interrupted','cancelled','skipped')
BEGIN
  UPDATE history_record SET revision=revision+1 WHERE collection='annotations' AND id=new.annotation_id AND owner=new.owner;
  UPDATE history_event SET kind='entry-updated', entry_id=CAST(new.id AS TEXT)
    WHERE collection='annotations' AND record_id=new.annotation_id AND owner=new.owner
      AND sequence=(SELECT revision FROM history_record WHERE collection='annotations' AND id=new.annotation_id AND owner=new.owner);
END;
CREATE TRIGGER history_browser_annotation_attempt_entry_mask BEFORE UPDATE OF masked_at ON history_entry
WHEN new.collection='annotations' AND new.masked_at IS NOT NULL
  AND EXISTS(SELECT 1 FROM browser_annotation_attempt old WHERE old.annotation_id=new.record_id AND CAST(old.id AS TEXT)=new.id AND (json_extract(old.body,'$.status') IN ('queued','running','saving')) AND old.owner=new.owner)
BEGIN
  SELECT RAISE(ABORT, 'Stop active work before deleting this history entry.');
END;
