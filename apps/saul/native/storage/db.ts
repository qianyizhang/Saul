import { historyCursor } from './history-cursor.ts';
import { entryMask, maskFilter, recordMask, type HistoryVisibility } from './visibility.ts';
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
import type { SqlDatabase, SqlValue } from './sql.ts';
import { nanoid } from 'nanoid';
import { searchableResponse } from './search.ts';
import { TagStreamParser } from '../../shared/model/tag-stream-parser.ts';
import type {
  DbOperations,
  DbRequest,
  HistoryItem,
  Passage,
  RunResult,
  RunInput,
  Submission,
} from '../../shared/protocol/history-types.ts';
import { EXPLAIN_RECIPE_ID } from '../../shared/model/action-ids.ts';
import { inspectionInput } from '../../shared/model/inspection.ts';
import type { SelectionSnapshot } from '../../shared/model/reading.ts';

type Row = Record<string, SqlValue>;
const browserMask = (id: string) => recordMask('library-browser', id);
const nativeMask = (id: string) => recordMask('library-native', id);
const nativeEntryMask = (id: string) =>
  `COALESCE(${nativeMask(id)},${entryMask('library-native', id, id)})`;
const nativeHasEntry = (id: string) =>
  `EXISTS(SELECT 1 FROM history_entry WHERE collection='library-native' AND record_id=${id} AND history_entry.id=${id} AND owner='')`;
const runMask = entryMask('library-browser', 'llm_run.selection_id', 'llm_run.id');
const effectiveRunMask = `COALESCE(${browserMask('llm_run.selection_id')},${runMask})`;
const runProjection = (visibility: HistoryVisibility) =>
  visibility === 'visible' ? `${runMask} IS NULL` : '1';
const latest = (visibility: HistoryVisibility) =>
  `(SELECT rowid FROM llm_run WHERE selection_id=s.id AND ${runProjection(visibility)} ORDER BY created_at DESC,rowid DESC LIMIT 1)`;
const success = (visibility: HistoryVisibility) =>
  `(SELECT rowid FROM llm_run WHERE selection_id=s.id AND ${runProjection(visibility)} AND status='completed' ORDER BY created_at DESC,rowid DESC LIMIT 1)`;
const passageSelect = (visibility: HistoryVisibility) => `SELECT s.*,
 (SELECT revision FROM history_record WHERE collection='library-browser' AND id=s.id AND owner='') AS revision,
 p.url, p.title, p.canonical_url, s.bookmarked_at IS NOT NULL AS bookmarked,
 COALESCE(${browserMask('s.id')},${entryMask('library-browser', 's.id', 'r.id')}) AS run_masked_at,
 COALESCE(${browserMask('s.id')},${entryMask('library-browser', 's.id', 'c.id')}) AS completed_masked_at,
 r.id AS run_id, r.status, r.response_structured IS NOT NULL AS has_image, r.response_raw, r.error_message, r.reason, r.model, r.provider, r.latency_ms, r.created_at AS run_created_at, r.viewed_at, r.input_json,
 c.id AS completed_id, c.response_structured IS NOT NULL AS completed_image, c.response_raw AS completed_raw, c.model AS completed_model, c.provider AS completed_provider, c.latency_ms AS completed_latency, c.created_at AS completed_at, c.viewed_at AS completed_viewed, c.input_json AS completed_input
 FROM selection s JOIN page p ON p.id = s.page_id
 JOIN llm_run r ON r.rowid = ${latest(visibility)}
 LEFT JOIN llm_run c ON c.rowid = ${success(visibility)}`;

export class SaulDatabase {
  private db: SqlDatabase;
  private owner: string;
  private readonly visibility: HistoryVisibility;
  constructor(db: SqlDatabase, owner: string, visibility: HistoryVisibility = 'visible') {
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
  private browserEntryFilter(): string {
    if (this.visibility === 'masked')
      return `(${browserMask('llm_run.selection_id')} IS NOT NULL OR ${runMask} IS NOT NULL)`;
    if (this.visibility === 'all') return '1';
    return `${browserMask('llm_run.selection_id')} IS NULL AND ${runMask} IS NULL`;
  }
  private run(row: Row): RunResult {
    const input: RunInput | undefined = row.input_json
      ? JSON.parse(String(row.input_json))
      : undefined;
    return {
      id: String(row.id),
      status: row.status as RunResult['status'],
      ...(row.masked_at != null ? { maskedAt: Number(row.masked_at) } : {}),
      hasImage: row.status === 'completed' && Boolean(row.has_image ?? row.response_structured),
      capability: input?.preset?.capability,
      imageOptions: input?.preset?.imageOptions,
      responseRaw: String(row.response_raw || ''),
      model: String(row.model),
      provider: String(row.provider),
      createdAt: Number(row.created_at),
      latencyMs: row.latency_ms == null ? undefined : Number(row.latency_ms),
      error: row.error_message ? String(row.error_message) : undefined,
      reason: row.reason ? String(row.reason) : undefined,
      viewedAt: row.viewed_at == null ? undefined : Number(row.viewed_at),
      inspection: input ? inspectionInput(input) : undefined,
      ...(input?.recipe ? { recipe: { id: input.recipe.id, name: input.recipe.name } } : {}),
      ...(input?.preset ? { preset: { id: input.preset.id, name: input.preset.name } } : {}),
    };
  }
  private passage(row: Row): Passage {
    const completedInput: RunInput | undefined = row.completed_input
      ? JSON.parse(String(row.completed_input))
      : undefined;
    const completed: RunResult | undefined = row.completed_id
      ? {
          id: String(row.completed_id),
          status: 'completed',
          ...(row.completed_masked_at != null ? { maskedAt: Number(row.completed_masked_at) } : {}),
          hasImage: Boolean(row.completed_image),
          capability: completedInput?.preset?.capability,
          imageOptions: completedInput?.preset?.imageOptions,
          responseRaw: String(row.completed_raw || ''),
          model: String(row.completed_model),
          provider: String(row.completed_provider),
          createdAt: Number(row.completed_at),
          latencyMs: row.completed_latency == null ? undefined : Number(row.completed_latency),
          viewedAt: row.completed_viewed == null ? undefined : Number(row.completed_viewed),
          inspection: completedInput ? inspectionInput(completedInput) : undefined,
          ...(completedInput?.recipe
            ? { recipe: { id: completedInput.recipe.id, name: completedInput.recipe.name } }
            : {}),
          ...(completedInput?.preset
            ? { preset: { id: completedInput.preset.id, name: completedInput.preset.name } }
            : {}),
        }
      : undefined;
    return {
      revision: Number(row.revision),
      snapshot: {
        id: String(row.id),
        text: String(row.text),
        page: {
          url: String(row.url),
          title: String(row.title || ''),
          canonicalUrl: row.canonical_url ? String(row.canonical_url) : undefined,
        },
        anchor: {
          exact: String(row.anchor_exact || row.text),
          prefix: String(row.prefix || ''),
          suffix: String(row.suffix || ''),
          textStart: row.text_start == null ? undefined : Number(row.text_start),
          textEnd: row.text_end == null ? undefined : Number(row.text_end),
          domPath: row.dom_path ? String(row.dom_path) : undefined,
        },
        viewport: { x: 0, y: 0, width: 0, height: 0, scrollX: 0, scrollY: 0 },
        capturedAt: Number(row.created_at),
      },
      bookmarked: Boolean(row.bookmarked),
      latest: this.run({
        ...row,
        id: row.run_id ?? null,
        created_at: row.run_created_at ?? null,
        masked_at: row.run_masked_at ?? null,
      }),
      completed,
      unread: !!completed && completed.viewedAt === undefined,
    };
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
      case 'DB_PAGE':
        return this.rows(
          passageSelect(this.visibility) +
            ` WHERE p.url=? AND ${maskFilter(browserMask('s.id'), this.visibility)} ORDER BY s.created_at DESC,s.id DESC`,
          [message.payload.url],
        ).map((row) => this.passage(row));
      case 'DB_PASSAGE': {
        const row = this.rows(
          passageSelect(this.visibility) +
            ` WHERE s.id=? AND ${maskFilter(browserMask('s.id'), this.visibility)}`,
          [message.payload.selectionId],
        )[0];
        return row ? this.passage(row) : undefined;
      }
      case 'DB_CONTEXT': {
        const { selectionId, runId } = message.payload;
        const row = this.rows(
          `SELECT context_json FROM llm_run WHERE selection_id=? AND ${this.browserEntryFilter()}` +
            (runId ? ' AND id=?' : '') +
            ' ORDER BY created_at DESC,rowid DESC LIMIT 1',
          runId ? [selectionId, runId] : [selectionId],
        )[0];
        if (!row) throw new Error('This passage no longer exists.');
        return JSON.parse(String(row.context_json));
      }
      case 'DB_INPUT': {
        const row = this.rows(
          `SELECT input_json FROM llm_run WHERE selection_id=? AND ${this.browserEntryFilter()}` +
            (message.payload.runId ? ' AND id=?' : '') +
            ' ORDER BY created_at DESC,rowid DESC LIMIT 1',
          message.payload.runId
            ? [message.payload.selectionId, message.payload.runId]
            : [message.payload.selectionId],
        )[0];
        if (!row) throw new Error('This passage no longer exists.');
        return row.input_json ? JSON.parse(String(row.input_json)) : undefined;
      }
      case 'DB_IMAGE': {
        if (!message.payload.selectionId.startsWith('ez:')) {
          const row = this.rows(
            `SELECT response_structured FROM llm_run WHERE selection_id=? AND status='completed' AND ${this.browserEntryFilter()}` +
              (message.payload.runId ? ' AND id=?' : '') +
              ' ORDER BY created_at DESC,rowid DESC LIMIT 1',
            message.payload.runId
              ? [message.payload.selectionId, message.payload.runId]
              : [message.payload.selectionId],
          )[0];
          if (!row?.response_structured) return;
          const image = JSON.parse(String(row.response_structured)) as GeneratedImage;
          validateGeneratedImage(image);
          return { data: image.data, mediaType: image.mediaType };
        }
        const id = message.payload.selectionId.slice(3);
        if (message.payload.runId && message.payload.runId.replace(/^ez:/, '') !== id) return;
        const row = this.rows(
          `SELECT image FROM ez_entry WHERE id=? AND ${nativeHasEntry('ez_entry.id')}
            AND ${maskFilter(nativeEntryMask('ez_entry.id'), this.visibility)}`,
          [id],
        )[0];
        if (!(row?.image instanceof Uint8Array)) return;
        let binary = '';
        for (const byte of row.image) binary += String.fromCharCode(byte);
        return {
          data: btoa(binary),
          mediaType: binary.startsWith('GIF8') ? 'image/gif' : 'image/png',
        };
      }
      case 'DB_READING_ATTEMPTS_PAGE': {
        const { selectionId, limit = 25, cursor } = message.payload;
        const pagination = historyCursor(
          [this.owner, 'reading.attempts', selectionId, this.visibility],
          cursor,
        );
        const before = pagination.read();
        if (selectionId.startsWith('ez:')) {
          const entry = this.ezHistory(selectionId.slice(3));
          return { items: entry && before === undefined ? [entry.latest] : [] };
        }
        const pageSize = Math.max(1, Math.min(100, limit));
        const rows = this.rows(
          `SELECT llm_run.id,status,response_raw,model,provider,created_at,latency_ms,error_message,reason,
            viewed_at,input_json,response_structured IS NOT NULL AS has_image,${effectiveRunMask} AS masked_at,e.position
           FROM llm_run JOIN history_entry e ON e.collection='library-browser'
             AND e.record_id=llm_run.selection_id AND e.owner='' AND e.id=llm_run.id
           WHERE llm_run.selection_id=? AND ${this.browserEntryFilter()}${before === undefined ? '' : ' AND e.position<?'}
           ORDER BY e.position DESC LIMIT ?`,
          [selectionId, ...(before === undefined ? [] : [before]), pageSize + 1],
        );
        const next = rows.length > pageSize;
        if (next) rows.pop();
        return {
          items: rows.map((row) => this.run(row)),
          ...(next ? { cursor: pagination.write(Number(rows.at(-1)!.position)) } : {}),
        };
      }
      case 'DB_RUNS':
        if (message.payload.selectionId.startsWith('ez:')) {
          const item = this.ezHistory(message.payload.selectionId.slice(3));
          return item ? [item.latest] : [];
        }
        return this.rows(
          `SELECT id,status,response_raw,model,provider,created_at,latency_ms,error_message,reason,viewed_at,input_json,response_structured IS NOT NULL AS has_image, ${effectiveRunMask} AS masked_at FROM llm_run WHERE selection_id=? AND ${this.browserEntryFilter()} ORDER BY created_at DESC,rowid DESC`,
          [message.payload.selectionId],
        ).map((row) => this.run(row));
      case 'DB_VIEW':
        if (message.payload.selectionId.startsWith('ez:')) return;
        this.write(
          `UPDATE llm_run SET viewed_at=? WHERE id=? AND selection_id=? AND status='completed' AND ${this.browserEntryFilter()}`,
          [Date.now(), message.payload.runId, message.payload.selectionId],
        );
        return;
      case 'DB_UNREAD':
        return Number(
          this.db.selectValue(
            `SELECT count(*) FROM selection s JOIN llm_run c ON c.rowid=${success('visible')} WHERE c.viewed_at IS NULL AND ${browserMask('s.id')} IS NULL`,
          ),
        );
      case 'DB_GET_HISTORY':
        return this.db.transaction(() => this.history(message.payload), 'deferred');
      case 'DB_SET_BOOKMARK':
        if (message.payload.selectionId.startsWith('ez:')) {
          this.write(
            `UPDATE ez_entry SET bookmarked=? WHERE id=? AND ${nativeHasEntry('ez_entry.id')}
              AND ${nativeEntryMask('ez_entry.id')} IS NULL`,
            [message.payload.bookmarked ? 1 : 0, message.payload.selectionId.slice(3)],
          );
          return;
        }
        this.write(
          `UPDATE selection SET bookmarked_at=${message.payload.bookmarked ? 'COALESCE(bookmarked_at,?)' : 'NULL'}
            WHERE id=? AND ${browserMask('selection.id')} IS NULL`,
          message.payload.bookmarked
            ? [Date.now(), message.payload.selectionId]
            : [message.payload.selectionId],
        );
        return;
      case 'DB_DIGEST_DELETE':
      case 'DB_DELETE_SELECTION':
      case 'DB_CLEAR_HISTORY':
      case 'DB_RESTORE_SELECTION':
      case 'DB_PURGE_SELECTION':
      case 'DB_HISTORY_PAGE':
        throw new Error('This operation requires the History repository.');
      case 'DB_EXPORT_MARKDOWN':
        return this.exportMarkdown();
    }
  }
  history(
    {
      limit = 50,
      offset = 0,
      searchQuery = '',
      bookmarksOnly = false,
    }: DbOperations['DB_GET_HISTORY']['payload'],
    before?: { createdAt: number; id: string; app: string },
  ): HistoryItem[] {
    const bind: SqlValue[] = [],
      filters = [maskFilter(browserMask('s.id'), this.visibility)];
    if (bookmarksOnly) filters.push('s.bookmarked_at IS NOT NULL');
    const query = searchQuery.trim();
    if (query) {
      const tokens = (query.match(/[\p{L}\p{N}_]+/gu) || [])
        .map((t) => '"' + t + '"*')
        .join(' AND ');
      const pattern = '%' + query.replace(/[\\%_]/g, (v) => '\\' + v) + '%';
      const literal = `s.text LIKE ? ESCAPE '\\' OR p.title LIKE ? ESCAPE '\\' OR p.url LIKE ? ESCAPE '\\' OR s.id IN (SELECT selection_id FROM llm_run JOIN explanation_fts f ON f.rowid=llm_run.rowid WHERE ${runProjection(this.visibility)} AND f.body LIKE ? ESCAPE '\\')`;
      filters.push(
        '(' +
          (tokens
            ? `s.rowid IN (SELECT rowid FROM selection_fts WHERE selection_fts MATCH ?) OR s.id IN (SELECT selection_id FROM llm_run WHERE ${runProjection(this.visibility)} AND rowid IN (SELECT rowid FROM explanation_fts WHERE explanation_fts MATCH ?)) OR `
            : '') +
          literal +
          ')',
      );
      if (tokens) bind.push(tokens, tokens);
      bind.push(pattern, pattern, pattern, pattern);
    }
    const nativeQuery = query
      ? " AND (json_extract(data,'$.query') LIKE ? ESCAPE '\\' OR json_extract(data,'$.response') LIKE ? ESCAPE '\\' OR json_extract(data,'$.recipeSnapshot.name') LIKE ? ESCAPE '\\')"
      : '';
    const pattern = '%' + query.replace(/[\\%_]/g, (v) => '\\' + v) + '%';
    const candidates = this.rows(
      `SELECT * FROM (SELECT s.id,s.created_at,'saul' AS app,${browserMask('s.id')} AS masked_at,
        (SELECT revision FROM history_record WHERE collection='library-browser' AND id=s.id AND owner='') AS revision FROM selection s JOIN page p ON p.id=s.page_id WHERE ${latest(this.visibility)} IS NOT NULL` +
        (filters.length ? ' AND ' + filters.join(' AND ') : '') +
        ` UNION ALL SELECT id,created_at,'ez' AS app,${nativeMask('ez_entry.id')},
        (SELECT revision FROM history_record WHERE collection='library-native' AND id=ez_entry.id AND owner='') FROM ez_entry WHERE json_extract(data,'$.status')!='pending'
        AND ${nativeHasEntry('ez_entry.id')} AND ${maskFilter(nativeMask('ez_entry.id'), this.visibility)}
        ${this.visibility === 'visible' ? `AND ${nativeEntryMask('ez_entry.id')} IS NULL` : ''}` +
        (bookmarksOnly ? ' AND bookmarked=1' : '') +
        nativeQuery +
        ')' +
        (before ? ' WHERE (created_at,id,app) < (?,?,?)' : '') +
        ' ORDER BY created_at DESC,id DESC,app DESC LIMIT ? OFFSET ?',
      [
        ...bind,
        ...(query ? [pattern, pattern, pattern] : []),
        ...(before ? [before.createdAt, before.id, before.app] : []),
        Math.max(1, Math.min(5000, Math.trunc(limit))),
        Math.max(0, Math.trunc(offset)),
      ],
    );
    return candidates.map((row) => {
      if (row.app === 'ez')
        return { ...this.ezHistory(String(row.id))!, revision: Number(row.revision) };
      const p = this.passage(
        this.rows(passageSelect(this.visibility) + ' WHERE s.id=?', [row.id!])[0]!,
      );
      const shown = p.completed || p.latest;
      return {
        selectionId: p.snapshot.id,
        selectedText: p.snapshot.text,
        revision: Number(row.revision),
        ...(row.masked_at != null ? { maskedAt: Number(row.masked_at) } : {}),
        pageTitle: p.snapshot.page.title,
        pageUrl: p.snapshot.page.url,
        responseRaw: shown.responseRaw,
        hasImage: shown.hasImage,
        model: shown.model,
        provider: shown.provider,
        latencyMs: shown.latencyMs,
        createdAt: p.snapshot.capturedAt,
        bookmarked: p.bookmarked,
        latest: p.latest,
        completed: p.completed,
        unread: p.unread,
      };
    });
  }
  private ezHistory(id: string): HistoryItem | undefined {
    const row = this.rows(
      `SELECT data,created_at,bookmarked,image IS NOT NULL AS has_image,${nativeMask('ez_entry.id')} AS masked_at,
        ${nativeEntryMask('ez_entry.id')} AS entry_masked_at
        FROM ez_entry WHERE id=? AND ${nativeHasEntry('ez_entry.id')}
          AND ${maskFilter(nativeEntryMask('ez_entry.id'), this.visibility)}`,
      [id],
    )[0];
    if (!row) return;
    const entry = JSON.parse(String(row.data)) as {
      query: string;
      response: string;
      model: string;
      instructions?: string;
      status: string;
      error?: string;
      durationSeconds?: number;
      followUpQuestion?: string;
      recipeSnapshot?: { id: string; name: string };
      presetSnapshot?: {
        id: string;
        name: string;
        capability?: RunResult['capability'];
        imageOptions?: RunResult['imageOptions'];
      };
      connectionSnapshot?: { kind: string };
      inputValues?: Record<string, string>;
      citations?: { url: string; title?: string }[];
    };
    const run: RunResult = {
      id: 'ez:' + id,
      ...(row.entry_masked_at != null ? { maskedAt: Number(row.entry_masked_at) } : {}),
      hasImage: !!row.has_image,
      capability: entry.presetSnapshot?.capability,
      imageOptions: entry.presetSnapshot?.imageOptions,
      status: entry.status === 'pending' ? 'interrupted' : (entry.status as RunResult['status']),
      responseRaw: entry.response,
      model: entry.model,
      provider: entry.connectionSnapshot?.kind || 'chatgpt-plan',
      createdAt: Number(row.created_at),
      latencyMs: entry.durationSeconds === undefined ? undefined : entry.durationSeconds * 1000,
      error: entry.error,
      recipe: entry.recipeSnapshot,
      preset: entry.presetSnapshot,
      inspection: {
        systemPrompt: entry.instructions || '',
        userPrompt: entry.query,
        followUpQuestion: entry.followUpQuestion,
        context: { selection: entry.query, pageTitle: 'EZ', pageUrl: '' },
      },
    };
    return {
      selectionId: 'ez:' + id,
      ...(row.masked_at != null ? { maskedAt: Number(row.masked_at) } : {}),
      selectedText:
        entry.followUpQuestion || Object.values(entry.inputValues || {}).join(' · ') || entry.query,
      pageTitle: 'EZ' + (entry.recipeSnapshot?.name ? ' · ' + entry.recipeSnapshot.name : ''),
      pageUrl: '',
      responseRaw: entry.response,
      model: entry.model,
      provider: run.provider,
      createdAt: Number(row.created_at),
      bookmarked: !!row.bookmarked,
      latest: run,
      completed: run.status === 'completed' ? run : undefined,
      unread: false,
      hasImage: !!row.has_image,
    };
  }

  private exportMarkdown(): string {
    const lines = ['# Saul Knowledge Export', `Generated on: ${new Date().toISOString()}`];
    let total = 0;
    for (let offset = 0; ; offset += 500) {
      const batch = this.history({ limit: 500, offset });
      total += batch.length;
      for (const item of batch) {
        lines.push(
          `\n## ${item.pageTitle} (${item.pageUrl})`,
          `### > "${item.selectedText}"`,
          `Captured: ${new Date(item.createdAt).toISOString()}`,
          item.bookmarked ? 'Bookmarked' : '',
        );
        if (item.selectionId.startsWith('ez:')) {
          lines.push(item.responseRaw);
          if (item.hasImage) lines.push('[Saved image in shared history]');
          continue;
        }
        const runs = this.rows(
          `SELECT id,status,response_raw,model,provider,created_at,latency_ms,error_message,reason,viewed_at,input_json,response_structured IS NOT NULL AS has_image, ${effectiveRunMask} AS masked_at FROM llm_run WHERE selection_id=? AND ${this.browserEntryFilter()} ORDER BY created_at DESC,rowid DESC`,
          [item.selectionId],
        );
        for (const run of runs) {
          const segments = new TagStreamParser().feed(String(run.response_raw || ''));
          const metadata = this.run(run);
          lines.push(
            `\n${run.status === 'completed' ? 'Completed' : 'Incomplete (' + run.status + ')'} · Model: ${run.model}`,
            ...(metadata.recipe
              ? [
                  `Action: ${metadata.recipe.name}${metadata.preset ? ` · Preset: ${metadata.preset.name}` : ''}`,
                ]
              : []),
            ...(metadata.inspection?.followUpQuestion
              ? [`Follow-up: ${metadata.inspection.followUpQuestion}`]
              : []),
            segments.map((s) => (s.type === 'text' ? s.text : s.term)).join(''),
          );
          for (const s of segments)
            if (s.type === 'term' && s.note) lines.push(`- **${s.term}:** ${s.note}`);
          if (run.error_message) lines.push(String(run.error_message));
        }
        lines.push('---');
      }
      if (batch.length < 500) break;
    }
    lines.splice(2, 0, `Total Selections: ${total}\n`);
    return lines.join('\n');
  }
}
