import type { z } from 'zod';
import { isRecord } from '../model/value.mts';
import type { DbType } from './history-types.ts';
import { READING_HISTORY_OPERATIONS } from './reading-history.mts';
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
type HistoryOperation = {
  policy: HistoryOperationPolicy;
  input?: z.ZodType;
  result?: z.ZodType;
};
// One exhaustive catalogue owns admission and reconnect eligibility. Sender permissions stay separate.
export const HISTORY_OPERATIONS = {
  DB_ANNOTATION: { policy: 'explicit-write' },
  DB_ANNOTATION_IMAGE: { policy: 'repeatable-write' },
  DB_ANNOTATION_ATTEMPT: { policy: 'explicit-write' },
  DB_ANNOTATION_STATUS: { policy: 'read' },
  DB_ANNOTATION_URLS: { policy: 'read' },
  DB_IMAGE: { policy: 'read' },
  DB_IMAGE_CHUNK: { policy: 'repeatable-write' },
  DB_READING_RESOLVE: { policy: 'repeatable-write' },
  DB_RECOVER: { policy: 'repeatable-write' },
  DB_PAGE: { policy: 'read' },
  DB_PASSAGE: { policy: 'read' },
  DB_CONTEXT: { policy: 'read' },
  DB_INPUT: { policy: 'read' },
  DB_RUNS: { policy: 'read' },
  DB_VIEW: { policy: 'repeatable-write' },
  DB_UNREAD: { policy: 'read' },
  DB_GET_HISTORY: { policy: 'read' },
  DB_SET_BOOKMARK: { policy: 'explicit-write' },
  DB_DELETE_SELECTION: { policy: 'explicit-write' },
  DB_CLEAR_HISTORY: { policy: 'explicit-write' },
  DB_EXPORT_MARKDOWN: { policy: 'read' },
  DB_DIGEST_FIND: { policy: 'read' },
  DB_DIGEST_ACTION_REVISIONS: { policy: 'read' },
  DB_DIGEST_CREATE: { policy: 'repeatable-write' },
  DB_DIGEST_GET: { policy: 'read' },
  DB_DIGEST_RETRY: { policy: 'repeatable-write' },
  DB_DIGEST_INTERRUPT: { policy: 'repeatable-write' },
  DB_DIGEST_LIST: { policy: 'read' },
  DB_DIGEST_ITEM: { policy: 'repeatable-write' },
  DB_DIGEST_SOURCE: { policy: 'read' },
  DB_DIGEST_RECOVER: { policy: 'repeatable-write' },
  DB_DIGEST_DELETE: { policy: 'explicit-write' },
  ...READING_HISTORY_OPERATIONS,
} as const satisfies Record<DbType, HistoryOperation>;
function historyOperation(operation: string): HistoryOperation | undefined {
  return Object.hasOwn(HISTORY_OPERATIONS, operation)
    ? HISTORY_OPERATIONS[operation as DbType]
    : undefined;
}

export function historyOperationPolicy(operation: string): HistoryOperationPolicy | undefined {
  return historyOperation(operation)?.policy;
}

export function validateHistoryResult(operation: string, event: unknown): void {
  const entry = historyOperation(operation);
  // The helper encodes void results as null in the native envelope.
  if (
    entry?.result &&
    (!isRecord(event) ||
      event.type !== 'result' ||
      !Object.hasOwn(event, 'value') ||
      !entry.result.safeParse(event.value ?? undefined).success)
  )
    throw new Error(
      `Saul history returned an invalid ${operation} reply. The write may have been applied.`,
    );
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
    const entry = historyOperation(v.message.type);
    if (entry?.input && !entry.input.safeParse(v.message.payload).success)
      throw new Error(`Invalid history operation payload for ${v.message.type}.`);
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
