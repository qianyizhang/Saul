import { isRecord } from './value.mts';
export type HistoryRequest =
  | {
      operation: 'db';
      requestId: string;
      owner: string;
      message: { type: string; payload?: unknown };
    }
  | { operation: 'import-begin'; id: string }
  | { operation: 'import-chunk'; id: string; offset: number; data: string }
  | { operation: 'import-finish'; id: string; size: number };
const operations = new Set([
  'DB_IMAGE',
  'DB_READING_RESOLVE',
  'DB_SUBMIT',
  'DB_RECOVER',
  'DB_CLAIM',
  'DB_SAVING',
  'DB_CHECKPOINT',
  'DB_FINISH',
  'DB_PAGE',
  'DB_PASSAGE',
  'DB_CONTEXT',
  'DB_INPUT',
  'DB_RUNS',
  'DB_VIEW',
  'DB_UNREAD',
  'DB_GET_HISTORY',
  'DB_SET_BOOKMARK',
  'DB_DELETE_SELECTION',
  'DB_CLEAR_HISTORY',
  'DB_EXPORT_MARKDOWN',
  'DB_DIGEST_FIND',
  'DB_DIGEST_ACTION_REVISIONS',
  'DB_DIGEST_CREATE',
  'DB_DIGEST_GET',
  'DB_DIGEST_LIST',
  'DB_DIGEST_ITEM',
  'DB_DIGEST_SOURCE',
  'DB_DIGEST_RECOVER',
  'DB_DIGEST_DELETE',
]);
export function validateHistoryRequest(v: unknown): asserts v is HistoryRequest {
  if (!isRecord(v)) throw new Error('Invalid history request.');
  if (v.operation === 'db') {
    if (typeof v.requestId !== 'string' || !/^[a-f\d-]{36}$/.test(v.requestId))
      throw new Error('Invalid history operation identity.');
    if (typeof v.owner !== 'string' || !/^[a-f\d-]{36}$/.test(v.owner))
      throw new Error('Invalid history owner.');
    if (
      !isRecord(v.message) ||
      typeof v.message.type !== 'string' ||
      !operations.has(v.message.type) ||
      (v.message.payload !== undefined && !isRecord(v.message.payload))
    )
      throw new Error('Invalid history operation.');
    return;
  }
  if (typeof v.id !== 'string' || !/^[a-f\d-]{36}$/.test(v.id))
    throw new Error('Invalid history migration identity.');
  if (v.operation === 'import-begin') return;
  if (
    v.operation === 'import-chunk' &&
    Number.isSafeInteger(v.offset) &&
    Number(v.offset) >= 0 &&
    typeof v.data === 'string' &&
    v.data.length <= 400_000 &&
    v.data.length % 4 === 0 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(v.data)
  )
    return;
  if (v.operation === 'import-finish' && Number.isSafeInteger(v.size) && Number(v.size) >= 0)
    return;
  throw new Error('Invalid history migration request.');
}
