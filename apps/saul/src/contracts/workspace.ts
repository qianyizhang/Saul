import type { DbRequest } from '../../shared/protocol/history-types.ts';
import { isId, isBoundedText, isRecord } from '../../shared/model/value.mts';
const revision = (v: unknown) => v === undefined || (Number.isSafeInteger(v) && Number(v) >= 0);
export function validateWorkspace(v: unknown): asserts v is DbRequest {
  if (!isRecord(v)) throw new Error('Invalid workspace request');
  const p = v.payload;
  let valid = false;
  switch (v.type) {
    case 'DB_HISTORY_PAGE':
      valid =
        isRecord(p) &&
        (p.limit === undefined || (Number.isSafeInteger(p.limit) && (p.limit as number) >= 0)) &&
        (p.cursor === undefined || isBoundedText(p.cursor, 4096)) &&
        (p.searchQuery === undefined || isBoundedText(p.searchQuery, 1000)) &&
        (p.visibility === undefined || p.visibility === 'visible' || p.visibility === 'masked') &&
        (p.bookmarksOnly === undefined || typeof p.bookmarksOnly === 'boolean');
      break;
    case 'DB_GET_HISTORY':
      valid =
        isRecord(p) &&
        ['limit', 'offset'].every(
          (k) => p[k] === undefined || (Number.isSafeInteger(p[k]) && (p[k] as number) >= 0),
        ) &&
        (p.searchQuery === undefined || isBoundedText(p.searchQuery, 1000)) &&
        (p.bookmarksOnly === undefined || typeof p.bookmarksOnly === 'boolean');
      break;
    case 'DB_DELETE_SELECTION':
      valid =
        isRecord(p) &&
        isId(p.selectionId) &&
        revision(p.expectedRevision) &&
        (p.stopRunId === undefined || isId(p.stopRunId));
      break;
    case 'DB_RESTORE_SELECTION':
    case 'DB_PURGE_SELECTION':
      valid = isRecord(p) && isId(p.selectionId) && revision(p.expectedRevision);
      break;
    case 'DB_IMAGE':
      valid = isRecord(p) && isId(p.selectionId) && (p.runId === undefined || isId(p.runId));
      break;
    case 'DB_RUNS':
    case 'DB_PASSAGE':
      valid = isRecord(p) && isId(p.selectionId);
      break;
    case 'DB_SET_BOOKMARK':
      valid =
        isRecord(p) &&
        isId(p.selectionId) &&
        typeof p.bookmarked === 'boolean' &&
        revision(p.expectedRevision);
      break;
    case 'DB_VIEW':
      valid = isRecord(p) && isId(p.selectionId) && isId(p.runId);
      break;
    case 'DB_CLEAR_HISTORY':
    case 'DB_EXPORT_MARKDOWN':
    case 'DB_UNREAD':
      valid = p === undefined;
      break;
  }
  if (!valid) throw new Error('Invalid or unavailable workspace operation');
}
