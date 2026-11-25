import type { DbRequest } from '../../shared/protocol/history-types.ts';
import { id, record, text } from '../reading/contract';
const revision = (v: unknown) => v === undefined || (Number.isSafeInteger(v) && Number(v) >= 0);
export function validateWorkspace(v: unknown): asserts v is DbRequest {
  if (!record(v)) throw new Error('Invalid workspace request');
  const p = v.payload;
  let valid = false;
  switch (v.type) {
    case 'DB_HISTORY_PAGE':
      valid =
        record(p) &&
        (p.limit === undefined || (Number.isSafeInteger(p.limit) && (p.limit as number) >= 0)) &&
        (p.cursor === undefined || text(p.cursor, 4096)) &&
        (p.searchQuery === undefined || text(p.searchQuery, 1000)) &&
        (p.visibility === undefined || p.visibility === 'visible' || p.visibility === 'masked') &&
        (p.bookmarksOnly === undefined || typeof p.bookmarksOnly === 'boolean');
      break;
    case 'DB_GET_HISTORY':
      valid =
        record(p) &&
        ['limit', 'offset'].every(
          (k) => p[k] === undefined || (Number.isSafeInteger(p[k]) && (p[k] as number) >= 0),
        ) &&
        (p.searchQuery === undefined || text(p.searchQuery, 1000)) &&
        (p.bookmarksOnly === undefined || typeof p.bookmarksOnly === 'boolean');
      break;
    case 'DB_DELETE_SELECTION':
      valid =
        record(p) &&
        id(p.selectionId) &&
        revision(p.expectedRevision) &&
        (p.stopRunId === undefined || id(p.stopRunId));
      break;
    case 'DB_RESTORE_SELECTION':
    case 'DB_PURGE_SELECTION':
      valid = record(p) && id(p.selectionId) && revision(p.expectedRevision);
      break;
    case 'DB_IMAGE':
      valid = record(p) && id(p.selectionId) && (p.runId === undefined || id(p.runId));
      break;
    case 'DB_RUNS':
    case 'DB_PASSAGE':
      valid = record(p) && id(p.selectionId);
      break;
    case 'DB_SET_BOOKMARK':
      valid =
        record(p) &&
        id(p.selectionId) &&
        typeof p.bookmarked === 'boolean' &&
        revision(p.expectedRevision);
      break;
    case 'DB_VIEW':
      valid = record(p) && id(p.selectionId) && id(p.runId);
      break;
    case 'DB_CLEAR_HISTORY':
    case 'DB_EXPORT_MARKDOWN':
    case 'DB_UNREAD':
      valid = p === undefined;
      break;
  }
  if (!valid) throw new Error('Invalid or unavailable workspace operation');
}
