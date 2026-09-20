import type { DbRequest } from '../types/storage';
import { id, record, text } from './reading';
export function validateWorkspace(v: unknown): asserts v is DbRequest {
  if (!record(v)) throw new Error('Invalid workspace request');
  const p = v.payload;
  let valid = false;
  switch (v.type) {
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
    case 'DB_RUNS':
    case 'DB_PASSAGE':
      valid = record(p) && id(p.selectionId);
      break;
    case 'DB_SET_BOOKMARK':
      valid = record(p) && id(p.selectionId) && typeof p.bookmarked === 'boolean';
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
