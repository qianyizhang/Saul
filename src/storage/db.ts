import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url';
import { nanoid } from 'nanoid';
import { INIT_SCHEMA_SQL } from './schema';
import { TagStreamParser } from '../parser/tag-stream-parser';
import type { HistoryItem } from '../types/storage';

export class SaulDatabase {
  private db: any = null;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  public async init(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const sqlite3 = await (sqlite3InitModule as any)({
          locateFile: () => wasmUrl,
          print: console.log,
          printErr: console.error,
        });

        // The offscreen document owns one dedicated worker and one pool.
        // SAH pool persists without SharedArrayBuffer or COOP/COEP headers.
        const pool = await sqlite3.installOpfsSAHPoolVfs({
          directory: '/saul-opfs',
        });
        this.db = new pool.OpfsSAHPoolDb('/saul.sqlite3');
        this.db.exec('PRAGMA foreign_keys = ON');
        console.log('[Saul DB] Initialized SQLite with OPFS persistence (/saul.sqlite3)');

        // Run schema migrations
        this.db.exec(INIT_SCHEMA_SQL);
        // Backfill old runs once; their original responses remain unchanged.
        const missing: { rowid: number; response_raw: string }[] = [];
        this.db.exec({
          sql: 'SELECT rowid, response_raw FROM llm_run WHERE rowid NOT IN (SELECT rowid FROM explanation_fts)',
          rowMode: 'object',
          callback: (row: any) => missing.push(row),
        });
        if (missing.length)
          this.db.transaction(() => {
            for (const row of missing)
              this.db.exec({
                sql: 'INSERT INTO explanation_fts(rowid, body) VALUES (?, ?)',
                bind: [row.rowid, this.searchableResponse(row.response_raw || '')],
              });
          });
        this.isInitialized = true;
        console.log('[Saul DB] Schema and FTS5 indices verified');
      } catch (err) {
        this.db?.close();
        this.db = null;
        throw new Error(
          'Persistent storage is unavailable. History was not saved. ' +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    })();

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private searchableResponse(raw: string): string {
    return new TagStreamParser()
      .feed(raw)
      .map((segment) =>
        segment.type === 'text' ? segment.text : segment.term + ' ' + segment.note,
      )
      .join(' ');
  }

  public async saveRecord(payload: {
    page: { url: string; title: string; canonicalUrl?: string };
    selection: {
      id: string;
      text: string;
      prefix?: string;
      suffix?: string;
      domPath?: string;
      rectJson?: string;
      createdAt: number;
    };
    llmRun: {
      id: string;
      widgetId: string;
      provider: string;
      model: string;
      promptVersion: string;
      promptRaw: string;
      contextJson: string;
      responseRaw: string;
      responseStructured?: string;
      latencyMs?: number;
      status: string;
      createdAt: number;
    };
  }): Promise<void> {
    await this.init();

    const pageId = nanoid();

    this.db.transaction(() => {
      // 1. Upsert page
      this.db.exec({
        sql: `
          INSERT INTO page (id, url, canonical_url, title, first_seen_at, last_seen_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(url) DO UPDATE SET
            title = excluded.title,
            last_seen_at = excluded.last_seen_at
        `,
        bind: [
          pageId,
          payload.page.url,
          payload.page.canonicalUrl || null,
          payload.page.title,
          payload.selection.createdAt,
          payload.selection.createdAt,
        ],
      });

      // Retrieve actual page id
      let actualPageId = pageId;
      this.db.exec({
        sql: `SELECT id FROM page WHERE url = ?`,
        bind: [payload.page.url],
        callback: (row: any[]) => {
          actualPageId = row[0];
        },
      });

      // 2. Insert selection
      this.db.exec({
        sql: `
          INSERT INTO selection (id, page_id, text, prefix, suffix, dom_path, rect_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING
        `,
        bind: [
          payload.selection.id,
          actualPageId,
          payload.selection.text,
          payload.selection.prefix || null,
          payload.selection.suffix || null,
          payload.selection.domPath || null,
          payload.selection.rectJson || null,
          payload.selection.createdAt,
        ],
      });

      // 3. Insert llm_run
      this.db.exec({
        sql: `
          INSERT INTO llm_run (
            id, selection_id, widget_id, provider, model, prompt_version,
            prompt_raw, context_json, response_raw, response_structured,
            latency_ms, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        bind: [
          payload.llmRun.id,
          payload.selection.id,
          payload.llmRun.widgetId,
          payload.llmRun.provider,
          payload.llmRun.model,
          payload.llmRun.promptVersion,
          payload.llmRun.promptRaw,
          payload.llmRun.contextJson,
          payload.llmRun.responseRaw,
          payload.llmRun.responseStructured || null,
          payload.llmRun.latencyMs || null,
          payload.llmRun.status,
          payload.llmRun.createdAt,
        ],
      });
      this.db.exec({
        sql: 'INSERT INTO explanation_fts(rowid, body) VALUES (last_insert_rowid(), ?)',
        bind: [this.searchableResponse(payload.llmRun.responseRaw)],
      });
    });
  }

  public async getHistory(
    limit = 50,
    offset = 0,
    searchQuery?: string,
    bookmarksOnly = false,
  ): Promise<HistoryItem[]> {
    await this.init();
    const items: HistoryItem[] = [];
    const query = searchQuery?.trim() || '';
    // Quote each term as a literal FTS token; punctuation cannot become an operator.
    const terms = query.match(/[\p{L}\p{N}_]+/gu) || [];
    const fts = terms.map((term) => '"' + term + '"*').join(' AND ');
    const filters: string[] = [];
    const bind: (string | number)[] = [];
    if (bookmarksOnly) filters.push('b.selection_id IS NOT NULL');
    if (query) {
      const pattern = '%' + query.replace(/[\\%_]/g, (value) => '\\' + value) + '%';
      const textMatch =
        "(s.text LIKE ? ESCAPE '\\' OR (SELECT body FROM explanation_fts WHERE rowid = r.rowid) LIKE ? ESCAPE '\\' OR p.title LIKE ? ESCAPE '\\' OR p.url LIKE ? ESCAPE '\\')";
      if (fts) {
        filters.push(`(s.rowid IN (SELECT rowid FROM selection_fts WHERE selection_fts MATCH ?)
          OR r.rowid IN (SELECT rowid FROM explanation_fts WHERE explanation_fts MATCH ?) OR ${textMatch})`);
        bind.push(fts, fts);
      } else filters.push(textMatch);
      bind.push(pattern, pattern, pattern, pattern);
    }
    this.db.exec({
      sql: `SELECT s.id AS selection_id, s.text AS selected_text, p.title AS page_title,
        p.url AS page_url, r.response_raw, r.model, r.provider, r.latency_ms,
        s.created_at, b.selection_id IS NOT NULL AS bookmarked
        FROM selection s JOIN page p ON p.id = s.page_id
        LEFT JOIN bookmark b ON b.selection_id = s.id
        LEFT JOIN llm_run r ON r.rowid = (SELECT rowid FROM llm_run WHERE selection_id = s.id
          ORDER BY created_at DESC, rowid DESC LIMIT 1)
        ${filters.length ? 'WHERE ' + filters.join(' AND ') : ''}
        ORDER BY s.created_at DESC, s.id DESC LIMIT ? OFFSET ?`,
      bind: [
        ...bind,
        Math.max(1, Math.min(5000, Math.trunc(limit))),
        Math.max(0, Math.trunc(offset)),
      ],
      rowMode: 'object',
      callback: (row: any) =>
        items.push({
          selectionId: row.selection_id,
          selectedText: row.selected_text,
          pageTitle: row.page_title,
          pageUrl: row.page_url,
          responseRaw: row.response_raw || '',
          model: row.model || '',
          provider: row.provider || '',
          latencyMs: row.latency_ms || undefined,
          createdAt: row.created_at,
          bookmarked: Boolean(row.bookmarked),
        }),
    });
    return items;
  }

  public async setBookmark(selectionId: string, bookmarked: boolean): Promise<void> {
    await this.init();
    this.db.exec({
      sql: bookmarked
        ? 'INSERT OR IGNORE INTO bookmark (selection_id, created_at) VALUES (?, ?)'
        : 'DELETE FROM bookmark WHERE selection_id = ?',
      bind: bookmarked ? [selectionId, Date.now()] : [selectionId],
    });
  }

  public async deleteSelection(selectionId: string): Promise<void> {
    await this.init();
    this.db.exec({
      sql: `DELETE FROM selection WHERE id = ?`,
      bind: [selectionId],
    });
  }

  public async clearAll(): Promise<void> {
    await this.init();
    this.db.exec(`
      DELETE FROM bookmark;
      DELETE FROM interaction;
      DELETE FROM llm_run;
      DELETE FROM selection;
      DELETE FROM page;
    `);
  }

  public async exportToMarkdown(): Promise<string> {
    const history: HistoryItem[] = [];
    for (let offset = 0; ; offset += 500) {
      const batch = await this.getHistory(500, offset);
      history.push(...batch);
      if (batch.length < 500) break;
    }
    const pagesMap = new Map<string, HistoryItem[]>();

    for (const item of history) {
      const key = item.pageTitle ? `${item.pageTitle} (${item.pageUrl})` : item.pageUrl;
      const list = pagesMap.get(key) || [];
      list.push(item);
      pagesMap.set(key, list);
    }

    const lines: string[] = [
      `# Saul Knowledge Export`,
      `Generated on: ${new Date().toISOString()}`,
      `Total Selections: ${history.length}\n`,
    ];

    pagesMap.forEach((items, pageKey) => {
      lines.push(`## ${pageKey}`);
      for (const item of items) {
        const dateStr = new Date(item.createdAt).toLocaleString();
        lines.push(`### > "${item.selectedText}"`);
        lines.push(`*Captured: ${dateStr} | Model: ${item.model}*`);
        const segments = new TagStreamParser().feed(item.responseRaw);
        lines.push(
          '\n' +
            segments
              .map((segment) => (segment.type === 'text' ? segment.text : segment.term))
              .join('') +
            '\n',
        );
        for (const segment of segments) {
          if (segment.type === 'term' && segment.note)
            lines.push(`- **${segment.term}:** ${segment.note}`);
        }
        if (item.bookmarked) lines.push('\nBookmarked');
        lines.push(`---`);
      }
    });

    return lines.join('\n');
  }
}

export const saulDb = new SaulDatabase();
