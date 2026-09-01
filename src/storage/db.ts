import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { nanoid } from 'nanoid';
import { INIT_SCHEMA_SQL } from './schema';
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
          print: console.log,
          printErr: console.error,
        });

        if ('opfs' in sqlite3) {
          try {
            this.db = new sqlite3.oo1.OpfsDb('/saul.sqlite3');
            console.log('[Saul DB] Initialized SQLite with OPFS persistence (/saul.sqlite3)');
          } catch (opfsErr) {
            console.warn('[Saul DB] OPFS initialization failed, falling back to in-memory DB:', opfsErr);
            this.db = new sqlite3.oo1.DB(':memory:', 'c');
          }
        } else {
          console.warn('[Saul DB] OPFS not available in this context, using DB(:memory:)');
          this.db = new sqlite3.oo1.DB(':memory:', 'c');
        }

        // Run schema migrations
        this.db.exec(INIT_SCHEMA_SQL);
        this.isInitialized = true;
        console.log('[Saul DB] Schema and FTS5 indices verified');
      } catch (err) {
        console.error('[Saul DB] Failed to initialize SQLite WASM:', err);
        throw err;
      }
    })();

    return this.initPromise;
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
    });
  }

  public async getHistory(
    limit = 50,
    offset = 0,
    searchQuery?: string
  ): Promise<HistoryItem[]> {
    await this.init();
    const items: HistoryItem[] = [];

    if (searchQuery && searchQuery.trim().length > 0) {
      // FTS5 Search query
      const sanitized = searchQuery.replace(/['"*]/g, '').trim() + '*';
      this.db.exec({
        sql: `
          SELECT 
            s.id AS selection_id,
            s.text AS selected_text,
            p.title AS page_title,
            p.url AS page_url,
            r.response_raw AS response_raw,
            r.model AS model,
            r.provider AS provider,
            r.latency_ms AS latency_ms,
            s.created_at AS created_at
          FROM selection_fts f
          JOIN selection s ON s.rowid = f.rowid
          JOIN page p ON p.id = s.page_id
          LEFT JOIN llm_run r ON r.selection_id = s.id
          WHERE selection_fts MATCH ?
          ORDER BY s.created_at DESC
          LIMIT ? OFFSET ?
        `,
        bind: [sanitized, limit, offset],
        rowMode: 'object',
        callback: (row: any) => {
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
          });
        },
      });
    } else {
      // Standard chronological query
      this.db.exec({
        sql: `
          SELECT 
            s.id AS selection_id,
            s.text AS selected_text,
            p.title AS page_title,
            p.url AS page_url,
            r.response_raw AS response_raw,
            r.model AS model,
            r.provider AS provider,
            r.latency_ms AS latency_ms,
            s.created_at AS created_at
          FROM selection s
          JOIN page p ON p.id = s.page_id
          LEFT JOIN llm_run r ON r.selection_id = s.id
          ORDER BY s.created_at DESC
          LIMIT ? OFFSET ?
        `,
        bind: [limit, offset],
        rowMode: 'object',
        callback: (row: any) => {
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
          });
        },
      });
    }

    return items;
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
      DELETE FROM interaction;
      DELETE FROM llm_run;
      DELETE FROM selection;
      DELETE FROM page;
    `);
  }

  public async exportToMarkdown(): Promise<string> {
    const history = await this.getHistory(1000, 0);
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
        lines.push(`\n${item.responseRaw}\n`);
        lines.push(`---`);
      }
    });

    return lines.join('\n');
  }
}

export const saulDb = new SaulDatabase();
