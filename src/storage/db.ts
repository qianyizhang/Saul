import sqlite3InitModule, { type Database, type SqlValue } from '@sqlite.org/sqlite-wasm';
import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url';
import { nanoid } from 'nanoid';
import { migrate, searchableResponse } from './schema';
import { TagStreamParser } from '../parser/tag-stream-parser';
import type {
  DbOperations,
  DbRequest,
  DbType,
  HistoryItem,
  Passage,
  RunResult,
  Submission,
} from '../types/storage';

type Row = Record<string, SqlValue>;
const latest = `(SELECT rowid FROM llm_run WHERE selection_id = s.id ORDER BY created_at DESC, rowid DESC LIMIT 1)`;
const success = `(SELECT rowid FROM llm_run WHERE selection_id = s.id AND status = 'completed' ORDER BY created_at DESC, rowid DESC LIMIT 1)`;
const passageSelect = `SELECT s.*, p.url, p.title, p.canonical_url, b.selection_id IS NOT NULL AS bookmarked,
 r.id AS run_id, r.status, r.response_raw, r.error_message, r.reason, r.model, r.provider, r.latency_ms, r.created_at AS run_created_at, r.viewed_at,
 c.id AS completed_id, c.response_raw AS completed_raw, c.model AS completed_model, c.provider AS completed_provider, c.latency_ms AS completed_latency, c.created_at AS completed_at, c.viewed_at AS completed_viewed
 FROM selection s JOIN page p ON p.id = s.page_id
 LEFT JOIN bookmark b ON b.selection_id = s.id
 JOIN llm_run r ON r.rowid = ${latest}
 LEFT JOIN llm_run c ON c.rowid = ${success}`;

export class SaulDatabase {
  private db!: Database;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  public async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      try {
        const sqlite = await (
          sqlite3InitModule as unknown as (options: {
            locateFile: () => string;
          }) => ReturnType<typeof sqlite3InitModule>
        )({ locateFile: () => wasmUrl });
        const pool = await sqlite.installOpfsSAHPoolVfs({ directory: '/saul-opfs' });
        this.db = new pool.OpfsSAHPoolDb('/saul.sqlite3');
        this.db.exec('PRAGMA foreign_keys = ON');
        migrate(this.db);
        this.initialized = true;
      } catch (error) {
        this.db?.close();
        throw new Error(
          'Persistent storage is unavailable. History was not saved. ' +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    })();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }
  private rows(sql: string, bind: SqlValue[] = []): Row[] {
    return this.db.selectObjects(sql, bind);
  }
  private write(sql: string, bind: SqlValue[] = []) {
    this.db.exec({ sql, bind });
  }
  private run(row: Row): RunResult {
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
    };
  }
  private passage(row: Row): Passage {
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
  private submit(payload: Submission): DbOperations['DB_SUBMIT']['result'] {
    let result!: DbOperations['DB_SUBMIT']['result'];
    this.db.transaction(() => {
      const existing = this.rows(
        'SELECT q.selection_id,p.url FROM submission q LEFT JOIN selection s ON s.id=q.selection_id LEFT JOIN page p ON p.id=s.page_id WHERE q.id = ?',
        [payload.submissionId],
      )[0];
      if (existing) {
        if (!existing.selection_id)
          throw new Error(
            'This submitted passage was deleted. Select the text again to create a new passage.',
          );
        if (existing.url !== payload.snapshot.page.url)
          throw new Error('This submission belongs to another page.');
        result = { passageId: String(existing.selection_id) };
        return;
      }
      const { snapshot: s, input } = payload;
      this.write(
        `INSERT INTO page (id,url,canonical_url,title,first_seen_at,last_seen_at) VALUES (?,?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET title=excluded.title,last_seen_at=excluded.last_seen_at`,
        [nanoid(), s.page.url, s.page.canonicalUrl || null, s.page.title, s.capturedAt, Date.now()],
      );
      const pageId = this.rows('SELECT id FROM page WHERE url=?', [s.page.url])[0]!.id!;
      const key = JSON.stringify([
        s.anchor.exact,
        s.anchor.prefix,
        s.anchor.suffix,
        s.anchor.textStart,
        s.anchor.textEnd,
      ]);
      const known = this.rows(
        'SELECT id FROM selection WHERE page_id=? AND (id=? OR anchor_key=?)',
        [pageId, s.id, key],
      )[0];
      const selectionId = known ? String(known.id) : s.id;
      if (
        known &&
        (!payload.regenerate ||
          this.rows(
            "SELECT id FROM llm_run WHERE selection_id=? AND status IN ('queued','running','saving')",
            [selectionId],
          ).length)
      ) {
        this.write('INSERT INTO submission(id,selection_id) VALUES (?,?)', [
          payload.submissionId,
          selectionId,
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
        `INSERT INTO llm_run (id,selection_id,widget_id,provider,model,prompt_version,prompt_raw,context_json,response_raw,status,created_at,submission_id,input_json) VALUES (?,?,'explain',?,?,'2',?,?,'','queued',?,?,?)`,
        [
          runId,
          selectionId,
          input.provider,
          input.provider === 'chrome-ai' ? 'gemini-nano' : input.remote.model,
          input.systemPrompt,
          JSON.stringify(input.context),
          Date.now(),
          payload.submissionId,
          JSON.stringify(input),
        ],
      );
      this.write('INSERT INTO submission(id,selection_id) VALUES (?,?)', [
        payload.submissionId,
        selectionId,
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
  ): Promise<DbOperations[K]['result']> {
    await this.init();
    // The switch is exhaustive; the generic signature preserves request/result pairs at callers.
    return this.executeReady(message as DbRequest) as DbOperations[K]['result'];
  }
  private executeReady(message: DbRequest): unknown {
    switch (message.type) {
      case 'DB_SUBMIT':
        return this.submit(message.payload);
      case 'DB_RECOVER':
        this.write(
          "UPDATE llm_run SET status='interrupted', reason='runner-lost', error_message='Generation was interrupted. Retry to send a new request.' WHERE status IN ('queued','running','saving')",
        );
        return;
      case 'DB_CLAIM':
        this.write("UPDATE llm_run SET status='running' WHERE id=? AND status='queued'", [
          message.payload.runId,
        ]);
        return this.db.changes() === 1;
      case 'DB_SAVING':
        this.write("UPDATE llm_run SET status='saving' WHERE id=? AND status='running'", [
          message.payload.runId,
        ]);
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
      case 'DB_RUNS':
        return this.rows(
          'SELECT * FROM llm_run WHERE selection_id=? ORDER BY created_at DESC,rowid DESC',
          [message.payload.selectionId],
        ).map((row) => this.run(row));
      case 'DB_VIEW':
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
        this.write('DELETE FROM selection WHERE id=?', [message.payload.selectionId]);
        return;
      case 'DB_CLEAR_HISTORY':
        this.db.transaction(() => this.db.exec('DELETE FROM interaction; DELETE FROM page;'));
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
    return this.rows(
      passageSelect +
        (filters.length ? ' WHERE ' + filters.join(' AND ') : '') +
        ' ORDER BY s.created_at DESC,s.id DESC LIMIT ? OFFSET ?',
      [...bind, Math.max(1, Math.min(5000, Math.trunc(limit))), Math.max(0, Math.trunc(offset))],
    ).map((row) => {
      const p = this.passage(row),
        shown = p.completed || p.latest;
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
        const runs = this.rows(
          'SELECT * FROM llm_run WHERE selection_id=? ORDER BY created_at DESC,rowid DESC',
          [item.selectionId],
        );
        for (const run of runs) {
          const segments = new TagStreamParser().feed(String(run.response_raw || ''));
          lines.push(
            `\n${run.status === 'completed' ? 'Completed' : 'Incomplete (' + run.status + ')'} · Model: ${run.model}`,
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
export const saulDb = new SaulDatabase();
