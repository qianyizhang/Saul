import { historyCursor } from './history-cursor.ts';
import {
  browserMask,
  runMask,
  entryMask,
  recordMask,
  maskFilter,
  type HistoryVisibility,
} from './visibility.ts';
import { validateGeneratedImage, type GeneratedImage } from '../../shared/model/image.ts';
import type { SqlDatabase, SqlValue, Row } from './sql.ts';
import type {
  DbOperations,
  DbRequest,
  RunInput,
  RunResult,
  Passage,
  HistoryItem,
} from '../../shared/protocol/history-types.ts';
import { inspectionInput } from '../../shared/model/inspection.ts';
import { exportHistoryMarkdown } from './history-markdown.ts';

const nativeMask = (id: string) => recordMask('library-native', id);
const nativeEntryMask = (id: string) =>
  `COALESCE(${nativeMask(id)},${entryMask('library-native', id, id)})`;
const nativeHasEntry = (id: string) =>
  `EXISTS(SELECT 1 FROM history_entry WHERE collection='library-native' AND record_id=${id} AND history_entry.id=${id} AND owner='')`;
const effectiveRunMask = `COALESCE(${browserMask('llm_run.selection_id')},${runMask})`;
const runProjection = (visibility: HistoryVisibility) =>
  visibility === 'visible' ? `${runMask} IS NULL` : '1';
const latest = (visibility: HistoryVisibility) =>
  `(SELECT rowid FROM llm_run WHERE selection_id=s.id AND ${runProjection(visibility)} ORDER BY created_at DESC,rowid DESC LIMIT 1)`;
const success = (visibility: HistoryVisibility) =>
  `(SELECT rowid FROM llm_run WHERE selection_id=s.id AND ${runProjection(visibility)} AND status='completed' ORDER BY created_at DESC,rowid DESC LIMIT 1)`;
const runFields = [
  'id',
  'status',
  'response_raw',
  'model',
  'provider',
  'created_at',
  'latency_ms',
  'error_message',
  'reason',
  'viewed_at',
  'input_json',
] as const;
function joinedColumns(alias: 'r' | 'c', prefix: 'latest' | 'completed') {
  return [
    ...runFields.map((name) => `${alias}.${name} AS ${prefix}_${name}`),
    `${alias}.response_structured IS NOT NULL AS ${prefix}_has_image`,
    `COALESCE(${browserMask('s.id')},${entryMask('library-browser', 's.id', alias + '.id')}) AS ${prefix}_masked_at`,
  ].join(',');
}
const passageSelect = (visibility: HistoryVisibility) => `SELECT s.*,
 (SELECT revision FROM history_record WHERE collection='library-browser' AND id=s.id AND owner='') AS revision,
 p.url, p.title, p.canonical_url, s.bookmarked_at IS NOT NULL AS bookmarked,
 ${joinedColumns('r', 'latest')}, ${joinedColumns('c', 'completed')} FROM selection s JOIN page p ON p.id = s.page_id
 JOIN llm_run r ON r.rowid = ${latest(visibility)}
 LEFT JOIN llm_run c ON c.rowid = ${success(visibility)}`;

type LibraryOperation =
  | 'DB_PAGE'
  | 'DB_PASSAGE'
  | 'DB_CONTEXT'
  | 'DB_INPUT'
  | 'DB_IMAGE'
  | 'DB_READING_ATTEMPTS_PAGE'
  | 'DB_RUNS'
  | 'DB_VIEW'
  | 'DB_UNREAD'
  | 'DB_GET_HISTORY'
  | 'DB_SET_BOOKMARK'
  | 'DB_EXPORT_MARKDOWN';
export class LibraryStore {
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
  private joinedRun(row: Row, prefix: string): RunResult {
    const fields: Row = {};
    for (const name of runFields) fields[name] = row[prefix + '_' + name] ?? null;
    fields.has_image = row[prefix + '_has_image'] ?? null;
    fields.masked_at = row[prefix + '_masked_at'] ?? null;
    return this.run(fields);
  }
  private passage(row: Row): Passage {
    const completed = row.completed_id == null ? undefined : this.joinedRun(row, 'completed');
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
      latest: this.joinedRun(row, 'latest'),
      completed,
      unread: !!completed && completed.viewedAt === undefined,
    };
  }
  execute(message: DbRequest<LibraryOperation>): unknown {
    switch (message.type) {
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
        return this.runs(message.payload.selectionId);
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
        return this.db.transaction(() => this.list(message.payload), 'deferred');
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
      case 'DB_EXPORT_MARKDOWN':
        return exportHistoryMarkdown(
          (offset, limit) => this.list({ offset, limit }),
          (id) => this.runs(id),
        );
    }
  }
  private runs(selectionId: string): RunResult[] {
    if (selectionId.startsWith('ez:')) {
      const item = this.ezHistory(selectionId.slice(3));
      return item ? [item.latest] : [];
    }
    return this.rows(
      `SELECT id,status,response_raw,model,provider,created_at,latency_ms,error_message,reason,viewed_at,input_json,response_structured IS NOT NULL AS has_image, ${effectiveRunMask} AS masked_at FROM llm_run WHERE selection_id=? AND ${this.browserEntryFilter()} ORDER BY created_at DESC,rowid DESC`,
      [selectionId],
    ).map((row) => this.run(row));
  }
  list(
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
      const promptMatch = `EXISTS (SELECT 1 FROM llm_run WHERE selection_id=s.id AND ${runProjection(this.visibility)}
        AND json_extract(CASE WHEN json_valid(input_json) THEN input_json END,'$.userPrompt') LIKE ? ESCAPE '\\')`;
      filters.push(
        '(' +
          (tokens
            ? `s.rowid IN (SELECT rowid FROM selection_fts WHERE selection_fts MATCH ?) OR s.id IN (SELECT selection_id FROM llm_run WHERE ${runProjection(this.visibility)} AND rowid IN (SELECT rowid FROM explanation_fts WHERE explanation_fts MATCH ?)) OR `
            : '') +
          literal +
          ' OR ' +
          promptMatch +
          ')',
      );
      if (tokens) bind.push(tokens, tokens);
      bind.push(pattern, pattern, pattern, pattern, pattern);
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
}
