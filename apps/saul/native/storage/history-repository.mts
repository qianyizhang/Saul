import { createHash } from 'node:crypto';
import type { DbRequest, HistoryItem } from '../../shared/protocol/history-types.ts';
import {
  decodeHistoryRequest,
  isHistoryToolRead,
  type HistoryTargetReference,
  type HistoryRequest,
} from '../../shared/protocol/history-protocol.mts';
import { SaulDatabase } from './db.ts';
import type { SqlDatabase } from './sql.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const retention = 365 * DAY_MS;
type Command = HistoryRequest['command'];
type Target = { collection: 'library' | 'calls' | 'annotations'; id: string; entryId?: string };
type Collection = 'library-browser' | 'library-native' | 'calls' | 'annotations';
type Key = { collection: Collection; id: string; owner: string; entryId?: string };
type Reply = { type: 'result'; value: unknown; revision?: number };
const tables = {
  'library-browser': 'selection',
  'library-native': 'ez_entry',
  calls: 'digest_batch',
  annotations: 'browser_annotation',
} as const;

function key(target: Target, owner: string): Key {
  if (target.collection === 'library') {
    const native = target.id.startsWith('ez:');
    return {
      collection: native ? 'library-native' : 'library-browser',
      id: native ? target.id.slice(3) : target.id,
      entryId: native ? target.entryId?.replace(/^ez:/, '') : target.entryId,
      owner: '',
    };
  }
  return {
    collection: target.collection,
    id: target.id,
    entryId: target.entryId,
    owner: target.collection === 'annotations' ? owner : '',
  };
}
function stableJSON(value: unknown): string {
  return JSON.stringify(value, (_property, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(
      Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  });
}
const hash = (value: unknown) => createHash('sha256').update(stableJSON(value)).digest('hex');

function searchExcerpt(item: HistoryItem, query: string): string {
  const needle = query.toLowerCase();
  for (const text of [
    item.selectedText,
    item.responseRaw,
    item.latest.inspection?.userPrompt,
    item.completed?.inspection?.userPrompt,
  ]) {
    if (!text) continue;
    const match = text.toLowerCase().indexOf(needle);
    if (match >= 0) {
      const start = Math.max(0, match - 60);
      return text.slice(start, start + 320);
    }
  }
  return (item.selectedText || item.responseRaw).slice(0, 320);
}

export class HistoryRepository {
  private readonly db: SqlDatabase;
  constructor(db: SqlDatabase) {
    this.db = db;
  }

  run(value: unknown): Reply {
    const { request, feature, validateResult } = decodeHistoryRequest(value);
    const { owner, operationId, command } = request;
    const reading = 'view' in command;
    const toolRead = isHistoryToolRead(request);
    if (!toolRead) this.expire();
    return this.db.transaction(
      () => {
        if (reading) {
          if (!feature) throw new Error('Unknown History view.');
          const { message } = feature;
          const browser = new SaulDatabase(
            this.db,
            owner,
            toolRead ? 'visible' : command.visibility,
          );
          if (message.type === 'DB_TOOL_HISTORY_SEARCH') {
            const { query, limit = 20, cursor } = message.payload;
            const page = this.list(browser, request, { searchQuery: query, limit, cursor });
            return this.reply(validateResult, {
              items: page.items.map((item) => ({
                id: item.selectionId,
                source: item.selectionId.startsWith('ez:') ? 'ez' : 'saul',
                createdAt: item.createdAt,
                title: item.pageTitle.slice(0, 200),
                excerpt: searchExcerpt(item, query),
              })),
              ...(page.cursor && { cursor: page.cursor }),
            });
          }
          const value =
            message.type === 'DB_HISTORY_PAGE'
              ? this.list(browser, request, message.payload)
              : browser.executeReady(message, operationId);
          const targets = this.resolveTargets(feature.targets(value), owner);
          const revision =
            targets.length === 1 && value != null ? this.revision(targets[0]!) : undefined;
          return this.reply(validateResult, value, revision);
        }
        const fingerprint = hash(['saul', owner, command]);
        const receipt = this.db.selectObject(
          'SELECT fingerprint,acknowledgement FROM history_receipt WHERE operation_id=?',
          [operationId],
        );
        if (receipt) {
          if (receipt.fingerprint !== fingerprint)
            throw new Error('Operation identity was already used for different History input.');
          const prior = JSON.parse(String(receipt.acknowledgement)) as Reply & { purged?: boolean };
          if (
            prior.purged ||
            (prior.value !== null &&
              this.db.selectValue(
                `SELECT 1 FROM history_receipt_record a JOIN history_record r
           ON (r.collection,r.id,r.owner)=(a.collection,a.record_id,a.owner)
           WHERE a.operation_id=? AND (r.masked_at IS NOT NULL OR EXISTS(
             SELECT 1 FROM history_entry e WHERE e.collection=r.collection AND e.record_id=r.id
               AND e.owner=r.owner AND e.masked_at IS NOT NULL
           )) LIMIT 1`,
                [operationId],
              ))
          )
            throw new Error('The write was applied. Its saved content is unavailable.');
          validateResult(prior);
          return prior;
        }

        const explicit =
          'target' in command && command.target ? key(command.target, owner) : undefined;
        const expected = 'expectedRevision' in command ? command.expectedRevision : undefined;
        if (explicit && expected !== undefined && (this.revision(explicit) ?? null) !== expected)
          throw new Error('History changed. Refresh the record before applying the write.');
        let reply: Reply;
        let affected: Key[] = [];
        if (command.kind === 'commit' && feature) {
          const value = new SaulDatabase(this.db, owner).executeReady(feature.message, operationId);
          affected = this.resolveTargets(feature.targets(value), owner);
          if (
            explicit &&
            (affected.length !== 1 ||
              affected[0]!.collection !== explicit.collection ||
              affected[0]!.owner !== explicit.owner ||
              affected[0]!.id !== explicit.id)
          )
            throw new Error('History change does not match its record target.');
          reply = this.reply(
            validateResult,
            value,
            affected.length === 1 ? this.revision(affected[0]!) : undefined,
          );
        } else {
          reply = this.reply(validateResult, null, this.lifecycle(command, owner));
        }
        this.db.exec({
          sql: 'INSERT INTO history_receipt VALUES(?,?,?)',
          bind: [operationId, fingerprint, JSON.stringify(reply)],
        });
        if (reply.value !== null) {
          for (const target of affected) {
            if (this.revision(target) === undefined) continue;
            this.db.exec({
              sql: 'INSERT INTO history_receipt_record VALUES(?,?,?,?)',
              bind: [operationId, target.collection, target.id, target.owner],
            });
          }
        }
        return reply;
      },
      reading ? 'deferred' : 'immediate',
    );
  }

  private resolveTargets(references: HistoryTargetReference[], owner: string): Key[] {
    return references.flatMap((reference) => {
      if (!('readingRunId' in reference)) return [key(reference, owner)];
      const selection = this.db.selectValue('SELECT selection_id FROM llm_run WHERE id=?', [
        reference.readingRunId,
      ]);
      return selection ? [key({ collection: 'library', id: String(selection) }, owner)] : [];
    });
  }

  private reply(
    validateResult: (event: unknown) => void,
    value: unknown,
    revision?: number,
  ): Reply {
    const reply: Reply = {
      type: 'result',
      value: value ?? null,
      ...(revision === undefined ? {} : { revision }),
    };
    validateResult(reply);
    return reply;
  }

  private list(
    browser: SaulDatabase,
    request: HistoryRequest,
    {
      cursor,
      limit = 50,
      searchQuery = '',
      bookmarksOnly = false,
    }: DbRequest<'DB_HISTORY_PAGE'>['payload'],
  ) {
    if (!('view' in request.command)) throw new Error('Invalid History view.');
    const pageSize = Math.max(1, Math.min(100, limit));
    const scope = hash([
      request.owner,
      request.command.view,
      request.command.visibility ?? 'visible',
      searchQuery,
      bookmarksOnly,
    ]);
    let before: { createdAt: number; id: string; app: string } | undefined;
    if (cursor) {
      const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      if (
        !Array.isArray(parsed) ||
        parsed.length !== 4 ||
        parsed[0] !== scope ||
        !Number.isSafeInteger(parsed[1]) ||
        typeof parsed[2] !== 'string' ||
        (parsed[3] !== 'saul' && parsed[3] !== 'ez')
      )
        throw new Error('History cursor does not belong to this view and filter.');
      before = { createdAt: parsed[1] as number, id: parsed[2], app: parsed[3] };
    }
    const items = browser.library.list({ limit: pageSize + 1, searchQuery, bookmarksOnly }, before);
    const next = items.length > pageSize;
    if (next) items.pop();
    const last = items.at(-1);
    const lastId = last?.selectionId;
    return {
      items,
      ...(next && last && lastId
        ? {
            cursor: Buffer.from(
              JSON.stringify([
                scope,
                last.createdAt,
                lastId.replace(/^ez:/, ''),
                lastId.startsWith('ez:') ? 'ez' : 'saul',
              ]),
            ).toString('base64url'),
          }
        : {}),
    };
  }

  private revision(target: Key) {
    const revision = this.db.selectValue(
      'SELECT revision FROM history_record WHERE collection=? AND id=? AND owner=?',
      [target.collection, target.id, target.owner],
    );
    return typeof revision === 'number' ? revision : undefined;
  }

  private lifecycle(command: Command, owner: string): number {
    if (command.kind === 'clear') {
      if (command.collection === 'library') {
        if (
          this.db.selectValue(
            "SELECT 1 FROM ez_entry WHERE json_extract(data,'$.status')='pending' LIMIT 1",
          )
        )
          throw new Error('Stop active work in EZ before clearing shared History.');
        if (
          this.db.selectValue(
            "SELECT 1 FROM llm_run WHERE status IN ('queued','running','saving') LIMIT 1",
          )
        )
          throw new Error('Stop active work in Saul before clearing shared History.');
        this.db.exec('DELETE FROM page; DELETE FROM ez_entry;');
      } else if (command.collection === 'calls') {
        this.db.exec('DELETE FROM digest_batch;');
      } else {
        this.db.exec({ sql: 'DELETE FROM browser_annotation WHERE owner=?', bind: [owner] });
      }
      return 0;
    }
    if (command.kind !== 'mask' && command.kind !== 'restore' && command.kind !== 'purge')
      throw new Error('Unsupported History lifecycle operation.');
    const target = key(command.target, owner);
    if (
      target.collection === 'library-native' &&
      target.entryId !== undefined &&
      target.entryId !== target.id
    )
      throw new Error('Saved History entry is unavailable.');
    const current = this.revision(target);
    if (current === undefined) throw new Error('Saved History record is unavailable.');
    if (command.kind === 'purge') {
      if (!this.purge(target)) throw new Error('Saved History entry is unavailable.');
      return target.entryId ? (this.revision(target) ?? current + 1) : current + 1;
    }
    const maskedAt = command.kind === 'mask' ? Date.now() : null;
    if (target.entryId) {
      this.db.exec({
        sql: 'UPDATE history_entry SET masked_at=? WHERE collection=? AND record_id=? AND owner=? AND id=? AND masked_at IS NOT ? AND (masked_at IS NULL OR ? IS NULL)',
        bind: [
          maskedAt,
          target.collection,
          target.id,
          target.owner,
          target.entryId,
          maskedAt,
          maskedAt,
        ],
      });
      if (this.db.changes())
        this.entryEvent(target, command.kind === 'mask' ? 'entry-masked' : 'entry-restored');
      else if (
        !this.db.selectValue(
          'SELECT 1 FROM history_entry WHERE collection=? AND record_id=? AND owner=? AND id=?',
          [target.collection, target.id, target.owner, target.entryId],
        )
      )
        throw new Error('Saved History entry is unavailable.');
    } else if (target.collection === 'annotations') {
      const body =
        maskedAt === null ? "json_remove(body,'$.deletedAt')" : "json_set(body,'$.deletedAt',?)";
      const changed = maskedAt === null ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL';
      this.db.exec({
        sql: `UPDATE browser_annotation SET deleted_at=?,
          body=json_set(${body},'$.revision',json_extract(body,'$.revision')+1,'$.updatedAt',?)
          WHERE owner=? AND id=? AND ${changed}`,
        bind: [
          maskedAt,
          ...(maskedAt === null ? [] : [maskedAt]),
          Date.now(),
          target.owner,
          target.id,
        ],
      });
    } else {
      this.db.exec({
        sql: 'UPDATE history_record SET masked_at=?,revision=revision+1 WHERE collection=? AND id=? AND owner=? AND masked_at IS NOT ? AND (masked_at IS NULL OR ? IS NULL)',
        bind: [maskedAt, target.collection, target.id, target.owner, maskedAt, maskedAt],
      });
    }
    return this.revision(target) ?? current;
  }

  private entryEvent(target: Key, kind: string) {
    if (target.collection === 'annotations') {
      this.db.exec({
        sql: `UPDATE browser_annotation SET body=json_set(body,
          '$.revision',json_extract(body,'$.revision')+1,'$.updatedAt',?) WHERE owner=? AND id=?`,
        bind: [Date.now(), target.owner, target.id],
      });
    } else {
      this.db.exec({
        sql: 'UPDATE history_record SET revision=revision+1 WHERE collection=? AND id=? AND owner=?',
        bind: [target.collection, target.id, target.owner],
      });
    }
    this.db.exec({
      sql: 'UPDATE history_event SET kind=?,entry_id=? WHERE collection=? AND record_id=? AND owner=? AND sequence=?',
      bind: [
        kind,
        target.entryId!,
        target.collection,
        target.id,
        target.owner,
        this.revision(target)!,
      ],
    });
  }

  private purge(target: Key): boolean {
    const { collection, entryId, id, owner } = target;
    if (!entryId) {
      this.db.exec({
        sql: `DELETE FROM ${tables[collection]} WHERE id=?${collection === 'annotations' ? ' AND owner=?' : ''}`,
        bind: collection === 'annotations' ? [id, owner] : [id],
      });
      const deleted = this.db.changes() > 0;
      if (collection === 'library-browser' && deleted)
        this.db.exec(
          'DELETE FROM page WHERE NOT EXISTS(SELECT 1 FROM selection WHERE page_id=page.id)',
        );
      return deleted;
    }
    if (
      !this.db.selectValue(
        'SELECT 1 FROM history_entry WHERE collection=? AND record_id=? AND owner=? AND id=?',
        [collection, id, owner, entryId],
      )
    )
      return false;
    if (collection === 'library-native') {
      this.db.exec({
        sql: 'DELETE FROM history_entry WHERE collection=? AND record_id=? AND owner=? AND id=?',
        bind: [collection, id, owner, entryId],
      });
    } else if (collection === 'annotations') {
      this.db.exec({
        sql: 'DELETE FROM browser_annotation_attempt WHERE owner=? AND annotation_id=? AND id=?',
        bind: [owner, id, entryId],
      });
      this.db.exec({
        sql: `UPDATE browser_annotation SET body=json_set(body,'$.replies',
          json((SELECT json_group_array(json(r.value)) FROM json_each(body,'$.replies') r
            WHERE json_extract(r.value,'$.id') IS NOT ?))) WHERE owner=? AND id=?`,
        bind: [entryId, owner, id],
      });
      this.db.exec({
        sql: 'DELETE FROM history_entry WHERE collection=? AND record_id=? AND owner=? AND id=?',
        bind: [collection, id, owner, entryId],
      });
    } else {
      this.db.exec({
        sql:
          collection === 'calls'
            ? 'DELETE FROM digest_item WHERE batch_id=? AND CAST(position AS TEXT)=?'
            : 'DELETE FROM llm_run WHERE selection_id=? AND id=?',
        bind: [id, entryId],
      });
    }
    this.entryEvent(target, 'entry-purged');
    return true;
  }

  private expire(now = Date.now()) {
    const cutoff = now - retention;
    const candidates =
      'SELECT 1 FROM history_record WHERE masked_at<=? UNION ALL SELECT 1 FROM history_entry WHERE masked_at<=? LIMIT 1';
    if (!this.db.selectValue(candidates, [cutoff, cutoff])) return;
    this.db.transaction(() => {
      for (const row of this.db.selectObjects('SELECT * FROM history_record WHERE masked_at<=?', [
        cutoff,
      ]))
        this.purge({
          collection: row.collection as Collection,
          id: String(row.id),
          owner: String(row.owner),
        });
      for (const row of this.db.selectObjects('SELECT * FROM history_entry WHERE masked_at<=?', [
        cutoff,
      ]))
        this.purge({
          collection: row.collection as Collection,
          id: String(row.record_id),
          owner: String(row.owner),
          entryId: String(row.id),
        });
    });
  }
}
