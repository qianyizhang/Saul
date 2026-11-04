import { digestStore } from '../digest/store';
import type { SqlDatabase, SqlValue } from './sql';
import { nanoid } from 'nanoid';
import { searchableResponse } from './search';
import { TagStreamParser } from '../parser/tag-stream-parser';
import type {
  DbOperations,
  DbRequest,
  DbType,
  HistoryItem,
  Passage,
  RunResult,
  RunInput,
  Submission,
} from '../types/storage';
import { EXPLAIN_RECIPE_ID } from '../models/configuration';
import { inspectionInput } from '../reading/inspection';
import type { SelectionSnapshot } from '../types';

type Row = Record<string, SqlValue>;
const latest = `(SELECT rowid FROM llm_run WHERE selection_id = s.id ORDER BY created_at DESC, rowid DESC LIMIT 1)`;
const success = `(SELECT rowid FROM llm_run WHERE selection_id = s.id AND status = 'completed' ORDER BY created_at DESC, rowid DESC LIMIT 1)`;
const passageSelect = `SELECT s.*, p.url, p.title, p.canonical_url, b.selection_id IS NOT NULL AS bookmarked,
 r.id AS run_id, r.status, r.response_raw, r.error_message, r.reason, r.model, r.provider, r.latency_ms, r.created_at AS run_created_at, r.viewed_at, r.input_json,
 c.id AS completed_id, c.response_raw AS completed_raw, c.model AS completed_model, c.provider AS completed_provider, c.latency_ms AS completed_latency, c.created_at AS completed_at, c.viewed_at AS completed_viewed, c.input_json AS completed_input
 FROM selection s JOIN page p ON p.id = s.page_id
 LEFT JOIN bookmark b ON b.selection_id = s.id
 JOIN llm_run r ON r.rowid = ${latest}
 LEFT JOIN llm_run c ON c.rowid = ${success}`;

export class SaulDatabase {
  private db: SqlDatabase;
  private owner: string;
  constructor(db: SqlDatabase, owner = '') {
    this.db = db;
    this.owner = owner;
  }
  private rows(sql: string, bind: SqlValue[] = []): Row[] {
    return this.db.selectObjects(sql, bind);
  }
  private write(sql: string, bind: SqlValue[] = []) {
    this.db.exec({ sql, bind });
  }
  private run(row: Row): RunResult {
    const input: RunInput | undefined = row.input_json
      ? JSON.parse(String(row.input_json))
      : undefined;
    return {
      id: String(row.id),
      status: row.status as RunResult['status'],
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
      latest: this.run({ ...row, id: row.run_id ?? null, created_at: row.run_created_at ?? null }),
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
      WHERE p.url=? AND (s.id=? OR s.anchor_key=? OR
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
      'SELECT q.selection_id,p.url FROM submission q LEFT JOIN selection s ON s.id=q.selection_id LEFT JOIN page p ON p.id=s.page_id WHERE q.id = ?',
      [submissionId],
    )[0];
    if (!existing) return;
    if (!existing.selection_id)
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
      const { snapshot: s, input } = payload;
      this.write(
        `INSERT INTO page (id,url,canonical_url,title,first_seen_at,last_seen_at) VALUES (?,?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET title=excluded.title,last_seen_at=excluded.last_seen_at`,
        [nanoid(), s.page.url, s.page.canonicalUrl || null, s.page.title, s.capturedAt, Date.now()],
      );
      const pageId = this.rows('SELECT id FROM page WHERE url=?', [s.page.url])[0]!.id!;
      const key = this.anchorKey(s);
      const known = this.findSelection(s);
      const selectionId = known || s.id;
      const prior = known
        ? this.rows(
            'SELECT input_json,status FROM llm_run WHERE selection_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1',
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
        `INSERT INTO llm_run (id,selection_id,widget_id,provider,model,prompt_version,prompt_raw,context_json,response_raw,status,created_at,submission_id,input_json,owner) VALUES (?,?,'explain',?,?,'2',?,?,'','queued',?,?,?,?)`,
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
  public async execute<K extends DbType>(
    message: DbRequest<K>,
    operationId: string = crypto.randomUUID(),
  ): Promise<DbOperations[K]['result']> {
    // The switch is exhaustive; the generic signature preserves request/result pairs at callers.
    return this.executeReady(message as DbRequest, operationId) as DbOperations[K]['result'];
  }
  private executeReady(message: DbRequest, operationId: string): unknown {
    switch (message.type) {
      case 'DB_READING_RESOLVE': {
        const { snapshot, submissionId, recipeId } = message.payload;
        const submitted = this.submittedSelection(submissionId, snapshot.page.url);
        if (submitted) return submitted;
        const selectionId = this.findSelection(snapshot);
        if (!selectionId) return;
        const prior = this.rows(
          'SELECT input_json FROM llm_run WHERE selection_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1',
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
      case 'DB_DIGEST_LIST':
      case 'DB_DIGEST_ITEM':
      case 'DB_DIGEST_SOURCE':
      case 'DB_DIGEST_RECOVER':
      case 'DB_DIGEST_DELETE':
        return digestStore(this.db, message, this.owner);
      case 'DB_SUBMIT':
        return this.submit(message.payload, operationId);
      case 'DB_RECOVER':
        this.write(
          "UPDATE llm_run SET status='interrupted', reason='runner-lost', error_message='Generation was interrupted. Retry to send a new request.' WHERE status IN ('queued','running','saving') AND (owner=? OR owner='')",
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
      case 'DB_FINISH': {
        const p = message.payload;
        let changed = false;
        this.db.transaction(() => {
          this.write(
            `UPDATE llm_run SET response_raw=?,status=?,error_message=?,reason=?,latency_ms=? WHERE id=? AND status IN (${p.status === 'completed' ? "'saving'" : "'queued','running','saving'"})`,
            [p.raw, p.status, p.error || null, p.reason || null, p.latencyMs, p.runId],
          );
          changed = this.db.changes() === 1;
          if (changed)
            this.write(
              'INSERT OR REPLACE INTO explanation_fts(rowid,body) SELECT rowid,? FROM llm_run WHERE id=?',
              [searchableResponse(p.raw), p.runId],
            );
        });
        return changed;
      }
      case 'DB_PAGE':
        return this.rows(passageSelect + ' WHERE p.url=? ORDER BY s.created_at DESC,s.id DESC', [
          message.payload.url,
        ]).map((row) => this.passage(row));
      case 'DB_PASSAGE': {
        const row = this.rows(passageSelect + ' WHERE s.id=?', [message.payload.selectionId])[0];
        return row ? this.passage(row) : undefined;
      }
      case 'DB_CONTEXT': {
        const row = this.rows(
          'SELECT context_json FROM llm_run WHERE selection_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1',
          [message.payload.selectionId],
        )[0];
        if (!row) throw new Error('This passage no longer exists.');
        return JSON.parse(String(row.context_json));
      }
      case 'DB_INPUT': {
        const row = this.rows(
          'SELECT input_json FROM llm_run WHERE selection_id=?' +
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
        const row = this.rows('SELECT image FROM ez_entry WHERE id=?', [
          message.payload.selectionId.slice(3),
        ])[0];
        if (!(row?.image instanceof Uint8Array)) return;
        let binary = '';
        for (const byte of row.image) binary += String.fromCharCode(byte);
        return { data: btoa(binary), mediaType: 'image/png' };
      }
      case 'DB_RUNS':
        if (message.payload.selectionId.startsWith('ez:')) {
          const item = this.ezHistory(message.payload.selectionId.slice(3));
          return item ? [item.latest] : [];
        }
        return this.rows(
          'SELECT * FROM llm_run WHERE selection_id=? ORDER BY created_at DESC,rowid DESC',
          [message.payload.selectionId],
        ).map((row) => this.run(row));
      case 'DB_VIEW':
        if (message.payload.selectionId.startsWith('ez:')) return;
        this.write(
          "UPDATE llm_run SET viewed_at=? WHERE id=? AND selection_id=? AND status='completed'",
          [Date.now(), message.payload.runId, message.payload.selectionId],
        );
        return;
      case 'DB_UNREAD':
        return Number(
          this.db.selectValue(
            `SELECT count(*) FROM selection s JOIN llm_run c ON c.rowid=${success} WHERE c.viewed_at IS NULL`,
          ),
        );
      case 'DB_GET_HISTORY':
        return this.history(message.payload);
      case 'DB_SET_BOOKMARK':
        if (message.payload.selectionId.startsWith('ez:')) {
          this.write('UPDATE ez_entry SET bookmarked=? WHERE id=?', [
            message.payload.bookmarked ? 1 : 0,
            message.payload.selectionId.slice(3),
          ]);
          return;
        }
        this.write(
          message.payload.bookmarked
            ? 'INSERT OR IGNORE INTO bookmark(selection_id,created_at) VALUES (?,?)'
            : 'DELETE FROM bookmark WHERE selection_id=?',
          message.payload.bookmarked
            ? [message.payload.selectionId, Date.now()]
            : [message.payload.selectionId],
        );
        return;
      case 'DB_DELETE_SELECTION':
        if (message.payload.selectionId.startsWith('ez:')) {
          const id = message.payload.selectionId.slice(3);
          if (
            this.rows(
              "SELECT id FROM ez_entry WHERE id=? AND json_extract(data,'$.status')='pending'",
              [id],
            ).length
          )
            throw new Error('Stop the running request in EZ before deleting it.');
          this.write('DELETE FROM ez_entry WHERE id=?', [id]);
          return;
        }
        this.db.transaction(() => {
          if (
            this.rows(
              "SELECT id FROM llm_run WHERE selection_id=? AND owner!=? AND status IN ('queued','running','saving')",
              [message.payload.selectionId, this.owner],
            ).length
          )
            throw new Error(
              'Stop the running request in its browser profile before deleting this history.',
            );
          this.write('DELETE FROM selection WHERE id=?', [message.payload.selectionId]);
        });
        return;
      case 'DB_CLEAR_HISTORY':
        this.db.transaction(() => {
          if (
            this.rows("SELECT id FROM ez_entry WHERE json_extract(data,'$.status')='pending'")
              .length ||
            this.rows(
              "SELECT id FROM llm_run WHERE owner!=? AND status IN ('queued','running','saving')",
              [this.owner],
            ).length
          )
            throw new Error(
              'Stop active requests in EZ and other browser profiles before clearing shared history.',
            );
          this.db.exec('DELETE FROM interaction; DELETE FROM page; DELETE FROM ez_entry;');
        });
        return;
      case 'DB_EXPORT_MARKDOWN':
        return this.exportMarkdown();
    }
  }
  private history({
    limit = 50,
    offset = 0,
    searchQuery = '',
    bookmarksOnly = false,
  }: DbOperations['DB_GET_HISTORY']['payload']): HistoryItem[] {
    const bind: SqlValue[] = [],
      filters: string[] = [];
    if (bookmarksOnly) filters.push('b.selection_id IS NOT NULL');
    const query = searchQuery.trim();
    if (query) {
      const tokens = (query.match(/[\p{L}\p{N}_]+/gu) || [])
        .map((t) => '"' + t + '"*')
        .join(' AND ');
      const pattern = '%' + query.replace(/[\\%_]/g, (v) => '\\' + v) + '%';
      const literal = `s.text LIKE ? ESCAPE '\\' OR p.title LIKE ? ESCAPE '\\' OR p.url LIKE ? ESCAPE '\\' OR s.id IN (SELECT selection_id FROM llm_run JOIN explanation_fts f ON f.rowid=llm_run.rowid WHERE f.body LIKE ? ESCAPE '\\')`;
      filters.push(
        '(' +
          (tokens
            ? `s.rowid IN (SELECT rowid FROM selection_fts WHERE selection_fts MATCH ?) OR s.id IN (SELECT selection_id FROM llm_run WHERE rowid IN (SELECT rowid FROM explanation_fts WHERE explanation_fts MATCH ?)) OR `
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
      `SELECT s.id,s.created_at,'saul' AS app FROM selection s JOIN page p ON p.id=s.page_id LEFT JOIN bookmark b ON b.selection_id=s.id WHERE EXISTS(SELECT 1 FROM llm_run WHERE selection_id=s.id)` +
        (filters.length ? ' AND ' + filters.join(' AND ') : '') +
        ` UNION ALL SELECT id,created_at,'ez' AS app FROM ez_entry WHERE json_extract(data,'$.status')!='pending'` +
        (bookmarksOnly ? ' AND bookmarked=1' : '') +
        nativeQuery +
        ' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?',
      [
        ...bind,
        ...(query ? [pattern, pattern, pattern] : []),
        Math.max(1, Math.min(5000, Math.trunc(limit))),
        Math.max(0, Math.trunc(offset)),
      ],
    );
    return candidates.map((row) => {
      if (row.app === 'ez') return this.ezHistory(String(row.id))!;
      const p = this.passage(this.rows(passageSelect + ' WHERE s.id=?', [row.id!])[0]!);
      const shown = p.completed || p.latest;
      return {
        selectionId: p.snapshot.id,
        selectedText: p.snapshot.text,
        pageTitle: p.snapshot.page.title,
        pageUrl: p.snapshot.page.url,
        responseRaw: shown.responseRaw,
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
      'SELECT data,created_at,bookmarked,image IS NOT NULL AS has_image FROM ez_entry WHERE id=?',
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
      presetSnapshot?: { id: string; name: string };
      providerSnapshot?: { kind: string };
      inputValues?: Record<string, string>;
      citations?: { url: string; title?: string }[];
    };
    const run: RunResult = {
      id: 'ez:' + id,
      status: entry.status === 'pending' ? 'interrupted' : (entry.status as RunResult['status']),
      responseRaw: entry.response,
      model: entry.model,
      provider: entry.providerSnapshot?.kind || 'chatgpt-plan',
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
          if (item.hasImage) lines.push('[Saved PNG image in shared history]');
          continue;
        }
        const runs = this.rows(
          'SELECT * FROM llm_run WHERE selection_id=? ORDER BY created_at DESC,rowid DESC',
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
