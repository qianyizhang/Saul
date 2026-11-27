import { LibraryStore } from './library-store.ts';
import { browserMask, runMask, type HistoryVisibility } from './visibility.ts';
import {
  annotationStore,
  annotationConversation,
  annotationActivity,
  annotationUrls,
  annotationAttempts,
  annotationImage,
  annotationStatus,
} from './annotations.mts';
import { validateGeneratedImage, type GeneratedImage } from '../../shared/model/image.ts';
import { digestStore } from './call-batches.ts';
import type { SqlDatabase, SqlValue, Row } from './sql.ts';
import { nanoid } from 'nanoid';
import { searchableResponse } from './search.ts';
import type {
  DbOperations,
  DbRequest,
  RunInput,
  Submission,
} from '../../shared/protocol/history-types.ts';
import { EXPLAIN_RECIPE_ID } from '../../shared/model/action-ids.ts';
import type { SelectionSnapshot } from '../../shared/model/reading.ts';

export class SaulDatabase {
  readonly library: LibraryStore;
  private db: SqlDatabase;
  private owner: string;
  private readonly visibility: HistoryVisibility;
  constructor(db: SqlDatabase, owner: string, visibility: HistoryVisibility = 'visible') {
    this.library = new LibraryStore(db, owner, visibility);
    this.db = db;
    this.owner = owner;
    this.visibility = visibility;
  }
  private rows(sql: string, bind: SqlValue[] = []): Row[] {
    return this.db.selectObjects(sql, bind);
  }
  private write(sql: string, bind: SqlValue[] = []) {
    this.db.exec({ sql, bind });
  }
  private anchorKey(s: SelectionSnapshot): string {
    return JSON.stringify([
      s.anchor.exact,
      s.anchor.prefix,
      s.anchor.suffix,
      s.anchor.textStart,
      s.anchor.textEnd,
    ]);
  }
  private findSelection(s: SelectionSnapshot): string | undefined {
    // Context can change without changing the selected occurrence. The fallback
    // requires exact text offsets plus a DOM location or unchanged leading context.
    // Text alone never matches, so separate occurrences remain separate.
    const matches = this.rows(
      `SELECT s.id FROM selection s JOIN page p ON p.id=s.page_id
      WHERE p.url=? AND ${browserMask('s.id')} IS NULL AND (s.id=? OR s.anchor_key=? OR
        (s.anchor_exact=? AND s.text_start=? AND s.text_end=? AND
          ((? != '' AND s.dom_path=?) OR (? != '' AND s.prefix=?))))`,
      [
        s.page.url,
        s.id,
        this.anchorKey(s),
        s.anchor.exact,
        s.anchor.textStart ?? null,
        s.anchor.textEnd ?? null,
        s.anchor.domPath || '',
        s.anchor.domPath || '',
        s.anchor.prefix,
        s.anchor.prefix,
      ],
    );
    return matches.length === 1 ? String(matches[0]!.id) : undefined;
  }
  private submittedSelection(submissionId: string, url: string): string | undefined {
    const existing = this.rows(
      `SELECT q.selection_id,p.url,${browserMask('s.id')} AS masked FROM submission q LEFT JOIN selection s ON s.id=q.selection_id LEFT JOIN page p ON p.id=s.page_id WHERE q.id = ?`,
      [submissionId],
    )[0];
    if (!existing) return;
    if (!existing.selection_id || existing.masked != null)
      throw new Error(
        'This submitted passage was deleted. Select the text again to create a new passage.',
      );
    if (existing.url !== url) throw new Error('This submission belongs to another page.');
    return String(existing.selection_id);
  }
  private submit(payload: Submission, operationId: string): DbOperations['DB_SUBMIT']['result'] {
    let result!: DbOperations['DB_SUBMIT']['result'];
    this.db.transaction(() => {
      const submitted = this.submittedSelection(payload.submissionId, payload.snapshot.page.url);
      if (submitted) {
        const queued = this.rows(
          "SELECT r.id,r.input_json FROM submission q JOIN llm_run r ON r.submission_id=q.id WHERE q.id=? AND q.operation_id=? AND r.status='queued'",
          [payload.submissionId, operationId],
        )[0];
        result = {
          passageId: submitted,
          ...(queued
            ? {
                run: {
                  id: String(queued.id),
                  selectionId: submitted,
                  pageUrl: payload.snapshot.page.url,
                  input: JSON.parse(String(queued.input_json)) as RunInput,
                },
              }
            : {}),
        };
        return;
      }
      const { snapshot: s, input, source } = payload;
      if (source) {
        const revision = this.db.selectValue(
          `SELECT r.revision FROM history_record r
           JOIN selection s ON s.id=r.id JOIN page p ON p.id=s.page_id
           JOIN history_entry e ON e.collection=r.collection AND e.record_id=r.id AND e.owner=r.owner
           WHERE r.collection='library-browser' AND r.owner='' AND r.id=? AND e.id=?
             AND r.masked_at IS NULL AND e.masked_at IS NULL AND p.url=?`,
          [source.selectionId, source.runId, s.page.url],
        );
        if (s.id !== source.selectionId || revision !== source.revision)
          throw new Error('The saved source changed or was deleted. Refresh it before submitting.');
      }
      this.write(
        `INSERT INTO page (id,url,canonical_url,title,first_seen_at,last_seen_at) VALUES (?,?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET title=excluded.title,last_seen_at=excluded.last_seen_at`,
        [nanoid(), s.page.url, s.page.canonicalUrl || null, s.page.title, s.capturedAt, Date.now()],
      );
      const pageId = this.rows('SELECT id FROM page WHERE url=?', [s.page.url])[0]!.id!;
      const key = this.anchorKey(s);
      const known = source?.selectionId ?? this.findSelection(s);
      const selectionId =
        known ||
        (this.db.selectValue(
          "SELECT id FROM selection WHERE id=? UNION SELECT id FROM history_tombstone WHERE collection='library-browser' AND id=?",
          [s.id, s.id],
        )
          ? nanoid()
          : s.id);
      const prior = known
        ? this.rows(
            `SELECT input_json,status FROM llm_run WHERE selection_id=? AND ${runMask} IS NULL ORDER BY created_at DESC,rowid DESC LIMIT 1`,
            [selectionId],
          )[0]
        : undefined;
      const priorInput: RunInput | undefined = prior?.input_json
        ? JSON.parse(String(prior.input_json))
        : undefined;
      const differentRecipe =
        !!input.recipe && input.recipe.id !== (priorInput?.recipe?.id || EXPLAIN_RECIPE_ID);
      if (
        known &&
        differentRecipe &&
        prior &&
        ['queued', 'running', 'saving'].includes(String(prior.status))
      )
        throw new Error(
          'This passage already has an active request. Stop it before choosing another action.',
        );
      if (
        known &&
        prior &&
        ((!payload.regenerate && !differentRecipe) ||
          this.rows(
            "SELECT id FROM llm_run WHERE selection_id=? AND status IN ('queued','running','saving')",
            [selectionId],
          ).length)
      ) {
        this.write('INSERT INTO submission(id,selection_id,operation_id) VALUES (?,?,?)', [
          payload.submissionId,
          selectionId,
          operationId,
        ]);
        result = { passageId: selectionId };
        return;
      }
      if (!known)
        this.write(
          'INSERT INTO selection (id,page_id,text,prefix,suffix,text_start,text_end,dom_path,created_at,anchor_exact,anchor_key) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          [
            selectionId,
            pageId,
            s.text,
            s.anchor.prefix,
            s.anchor.suffix,
            s.anchor.textStart ?? null,
            s.anchor.textEnd ?? null,
            s.anchor.domPath || null,
            s.capturedAt,
            s.anchor.exact,
            key,
          ],
        );
      const runId = nanoid();
      this.write(
        `INSERT INTO llm_run (id,selection_id,widget_id,provider,model,prompt_version,prompt_raw,context_json,response_raw,status,created_at,submission_id,input_json,owner,admission_source_id) VALUES (?,?,'explain',?,?,'2',?,?,'','queued',?,?,?,?,?)`,
        [
          runId,
          selectionId,
          input.provider,
          input.provider === 'chrome-ai'
            ? 'gemini-nano'
            : input.provider === 'chatgpt-plan'
              ? input.plan?.model || 'ChatGPT'
              : input.remote.model,
          input.systemPrompt,
          JSON.stringify(input.context),
          Date.now(),
          payload.submissionId,
          JSON.stringify(input),
          this.owner,
          source?.runId ?? null,
        ],
      );
      this.write('INSERT INTO submission(id,selection_id,operation_id) VALUES (?,?,?)', [
        payload.submissionId,
        selectionId,
        operationId,
      ]);
      result = {
        passageId: selectionId,
        run: { id: runId, selectionId, pageUrl: s.page.url, input },
      };
    });
    return result;
  }
  executeReady(message: DbRequest, operationId: string): unknown {
    switch (message.type) {
      case 'DB_ANNOTATION_URLS':
        return annotationUrls(this.db, this.owner, message.payload.url, this.visibility);
      case 'DB_ANNOTATION_IMAGE':
        return annotationImage(this.db, this.owner, message.payload);
      case 'DB_ANNOTATION':
        return annotationStore(this.db, this.owner, message.payload, Date.now(), this.visibility);
      case 'DB_ANNOTATION_CONVERSATION':
        return annotationConversation(this.db, this.owner, message.payload, this.visibility);
      case 'DB_ANNOTATION_ACTIVITY':
        return annotationActivity(this.db, this.owner, message.payload, this.visibility);
      case 'DB_ANNOTATION_ATTEMPT':
        return annotationAttempts(this.db, this.owner, message.payload, this.visibility);
      case 'DB_ANNOTATION_STATUS':
        return annotationStatus(this.db, this.owner, message.payload, Date.now(), this.visibility);
      case 'DB_READING_RESOLVE': {
        const { snapshot, submissionId, recipeId } = message.payload;
        const submitted = this.submittedSelection(submissionId, snapshot.page.url);
        if (submitted) return submitted;
        const selectionId = this.findSelection(snapshot);
        if (!selectionId) return;
        const prior = this.rows(
          `SELECT input_json FROM llm_run WHERE selection_id=? AND ${runMask} IS NULL ORDER BY created_at DESC,rowid DESC LIMIT 1`,
          [selectionId],
        )[0];
        if (!prior) return;
        const input: RunInput | undefined = prior.input_json
          ? JSON.parse(String(prior.input_json))
          : undefined;
        if ((input?.recipe?.id || EXPLAIN_RECIPE_ID) !== recipeId) return;
        this.write('INSERT INTO submission(id,selection_id) VALUES (?,?)', [
          submissionId,
          selectionId,
        ]);
        return selectionId;
      }
      case 'DB_DIGEST_FIND':
      case 'DB_DIGEST_ACTION_REVISIONS':
      case 'DB_DIGEST_CREATE':
      case 'DB_DIGEST_GET':
      case 'DB_DIGEST_RETRY':
      case 'DB_DIGEST_INTERRUPT':
      case 'DB_DIGEST_LIST':
      case 'DB_DIGEST_ITEM':
      case 'DB_DIGEST_ITEMS_PAGE':
      case 'DB_DIGEST_SOURCE':
      case 'DB_DIGEST_RECOVER':
        return digestStore(this.db, message, this.owner, this.visibility);
      case 'DB_SUBMIT':
        return this.submit(message.payload, operationId);
      case 'DB_RECOVER':
        this.write(
          "UPDATE llm_run SET response_structured=NULL, status='interrupted', reason='runner-lost', error_message='Generation was interrupted. Retry to send a new request.' WHERE status IN ('queued','running','saving') AND (owner=? OR owner='')",
          [this.owner],
        );
        return;
      case 'DB_CLAIM':
        this.write(
          "UPDATE llm_run SET status='running',transition_id=? WHERE id=? AND (status='queued' OR (status='running' AND transition_id=?))",
          [operationId, message.payload.runId, operationId],
        );
        return this.db.changes() === 1;
      case 'DB_SAVING':
        this.write(
          "UPDATE llm_run SET status='saving',transition_id=? WHERE id=? AND (status='running' OR (status='saving' AND transition_id=?))",
          [operationId, message.payload.runId, operationId],
        );
        return this.db.changes() === 1;
      case 'DB_CHECKPOINT':
        this.write("UPDATE llm_run SET response_raw=? WHERE id=? AND status='running'", [
          message.payload.raw,
          message.payload.runId,
        ]);
        return;
      case 'DB_IMAGE_CHUNK': {
        const p = message.payload;
        if (
          !Number.isSafeInteger(p.offset) ||
          p.offset < 0 ||
          typeof p.data !== 'string' ||
          !p.data.length ||
          p.data.length > 200_000 ||
          p.offset + p.data.length > 28_000_000 ||
          !['image/png', 'image/gif'].includes(p.mediaType) ||
          typeof p.last !== 'boolean' ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(p.data)
        )
          throw new Error('Invalid image chunk.');
        this.db.transaction(() => {
          const row = this.rows(
            "SELECT response_structured FROM llm_run WHERE id=? AND owner=? AND status IN ('running','saving')",
            [p.runId, this.owner],
          )[0];
          if (!row) throw new Error('The image attempt is no longer active.');
          const image = row.response_structured
            ? (JSON.parse(String(row.response_structured)) as GeneratedImage & {
                complete: boolean;
              })
            : { data: '', mediaType: p.mediaType, complete: false };
          if (image.mediaType !== p.mediaType) throw new Error('Image format changed during save.');
          // Reconnect may replay the acknowledged chunk, but never append it twice.
          if (
            p.offset < image.data.length &&
            image.data.slice(p.offset, p.offset + p.data.length) === p.data
          )
            return;
          if (image.complete || p.offset !== image.data.length)
            throw new Error('Invalid image save offset.');
          image.data += p.data;
          image.complete = p.last;
          if (p.last) validateGeneratedImage(image);
          this.write('UPDATE llm_run SET response_structured=? WHERE id=?', [
            JSON.stringify(image),
            p.runId,
          ]);
        });
        return;
      }
      case 'DB_FINISH': {
        const p = message.payload;
        let changed = false;
        this.db.transaction(() => {
          if (p.status === 'completed') {
            const row = this.rows('SELECT input_json,response_structured FROM llm_run WHERE id=?', [
              p.runId,
            ])[0];
            if (
              row &&
              JSON.parse(String(row.input_json || '{}')).preset?.capability === 'draw' &&
              (!row.response_structured || !JSON.parse(String(row.response_structured)).complete)
            )
              throw new Error('The generated image has not finished saving.');
          }
          this.write(
            `UPDATE llm_run SET response_raw=COALESCE(?,response_raw),status=?,error_message=?,reason=?,latency_ms=? WHERE id=? AND status IN (${p.status === 'completed' ? "'saving'" : "'queued','running','saving'"})`,
            [p.raw ?? null, p.status, p.error || null, p.reason || null, p.latencyMs, p.runId],
          );
          changed = this.db.changes() === 1;
          if (changed && p.status !== 'completed')
            this.write('UPDATE llm_run SET response_structured=NULL WHERE id=?', [p.runId]);
          if (changed) {
            const raw =
              p.raw ??
              String(
                this.db.selectValue('SELECT response_raw FROM llm_run WHERE id=?', [p.runId]) ?? '',
              );
            this.write(
              'INSERT OR REPLACE INTO explanation_fts(rowid,body) SELECT rowid,? FROM llm_run WHERE id=?',
              [searchableResponse(raw), p.runId],
            );
          }
        });
        return changed;
      }
      case 'DB_DIGEST_DELETE':
      case 'DB_DELETE_SELECTION':
      case 'DB_CLEAR_HISTORY':
      case 'DB_RESTORE_SELECTION':
      case 'DB_PURGE_SELECTION':
      case 'DB_TOOL_HISTORY_SEARCH':
      case 'DB_HISTORY_PAGE':
        throw new Error('This operation requires the History repository.');
      default:
        return this.library.execute(message);
    }
  }
}
