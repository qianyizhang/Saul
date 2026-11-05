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
export type HistoryOperationPolicy = 'read' | 'repeatable-write' | 'explicit-write';
// One exhaustive catalogue owns admission and reconnect eligibility. Sender permissions stay separate.
export const HISTORY_OPERATIONS = {
  DB_IMAGE: 'read',
  DB_READING_RESOLVE: 'repeatable-write',
  DB_SUBMIT: 'repeatable-write',
  DB_RECOVER: 'repeatable-write',
  DB_CLAIM: 'repeatable-write',
  DB_SAVING: 'repeatable-write',
  DB_CHECKPOINT: 'repeatable-write',
  DB_FINISH: 'repeatable-write',
  DB_PAGE: 'read',
  DB_PASSAGE: 'read',
  DB_CONTEXT: 'read',
  DB_INPUT: 'read',
  DB_RUNS: 'read',
  DB_VIEW: 'repeatable-write',
  DB_UNREAD: 'read',
  DB_GET_HISTORY: 'read',
  DB_SET_BOOKMARK: 'explicit-write',
  DB_DELETE_SELECTION: 'explicit-write',
  DB_CLEAR_HISTORY: 'explicit-write',
  DB_EXPORT_MARKDOWN: 'read',
  DB_DIGEST_FIND: 'read',
  DB_DIGEST_ACTION_REVISIONS: 'read',
  DB_DIGEST_CREATE: 'repeatable-write',
  DB_DIGEST_GET: 'read',
  DB_DIGEST_LIST: 'read',
  DB_DIGEST_ITEM: 'repeatable-write',
  DB_DIGEST_SOURCE: 'read',
  DB_DIGEST_RECOVER: 'repeatable-write',
  DB_DIGEST_DELETE: 'explicit-write',
} as const satisfies Record<string, HistoryOperationPolicy>;
type HistoryOperation = keyof typeof HISTORY_OPERATIONS;
export function historyOperationPolicy(operation: string): HistoryOperationPolicy | undefined {
  return Object.hasOwn(HISTORY_OPERATIONS, operation)
    ? HISTORY_OPERATIONS[operation as HistoryOperation]
    : undefined;
}
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
      historyOperationPolicy(v.message.type) === undefined ||
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
