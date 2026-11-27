import type { AdmittedCall } from '../../calls/admission';
import { isCallBatchId, validateCallControl } from '../../calls/batch-messages';
import {
  validateCallEditRequest,
  type CallEditRequest,
  type CallEditorState,
} from '../../calls/contract';
import type { PreparedModel } from '../../configuration/resolver';
import type {
  DbCall,
  DbOperations,
  DbRequest,
  Submission,
} from '../../../shared/protocol/history-types.ts';
import type { DigestResult } from '../../../shared/model/call-batch.ts';
import type { AnnotationRunRequest, AnnotationRunResult } from '../../annotations/runner';
import type { ReadingResult } from '../../reading/contract';
import { isId, isRecord } from '../../../shared/model/value.mts';
import { READING_HISTORY_OPERATIONS } from '../../../shared/protocol/reading-history.mts';
import { validateFeaturePayload } from '../../../shared/protocol/history-protocol.mts';
import { callSchemas, frozenModel } from '../../../shared/protocol/history-feature-schemas.mts';
import {
  annotationIdSchema,
  pageUrl,
  reviewedAnnotationSchema,
} from '../../../shared/protocol/annotations.ts';
import { validateWorkspace } from '../../contracts/workspace';
import { ensureOffscreenDocument } from './offscreen';
import { request } from './messages';

export const RUNNER_TARGET = 'saul-offscreen';
const runnerDbTypes = [
  'DB_ANNOTATION',
  'DB_ANNOTATION_STATUS',
  'DB_ANNOTATION_URLS',
  'DB_ANNOTATION_IMAGE',
  'DB_DIGEST_GET',
  'DB_READING_RESOLVE',
  'DB_RESTORE_SELECTION',
  'DB_PURGE_SELECTION',
  'DB_VIEW',
  'DB_SET_BOOKMARK',
  'DB_HISTORY_PAGE',
  'DB_GET_HISTORY',
  'DB_RUNS',
  'DB_PAGE',
  'DB_PASSAGE',
  'DB_CONTEXT',
  'DB_INPUT',
  'DB_IMAGE',
  'DB_UNREAD',
  'DB_EXPORT_MARKDOWN',
] as const satisfies readonly (keyof DbOperations)[];
export type RunnerDbType = (typeof runnerDbTypes)[number];
const runnerDbRoutes = new Set<string>(runnerDbTypes);
export type RunnerDbCall = DbCall<RunnerDbType>;

type RecordDeletion = { operation: 'delete' } & DbRequest<'DB_DELETE_SELECTION'>['payload'];
type ClearHistoryWire = {
  operation: 'delete';
  selectionId?: never;
  expectedRevision?: never;
  stopRunId?: never;
};
type RunnerOperation =
  | {
      operation: 'annotation';
      message: Extract<AnnotationRunRequest, { action: 'respond' }>;
      prepared: PreparedModel;
    }
  | {
      operation: 'annotation';
      message: Exclude<AnnotationRunRequest, { action: 'respond' }>;
      prepared?: never;
    }
  | {
      operation: 'action';
      message: CallEditRequest;
    }
  | ({ operation: 'digest' } & AdmittedCall)
  | { operation: 'submit'; submission: Submission; credential: string }
  | { operation: 'stop'; selectionId: string }
  | RecordDeletion;
type RunnerDbRequest<K extends RunnerDbType = RunnerDbType> = {
  operation: 'db';
  message: DbRequest<K>;
};
export type RunnerRequest = RunnerOperation | RunnerDbRequest | ClearHistoryWire;
export type RunnerResult<T extends RunnerOperation | ClearHistoryWire> = T extends {
  operation: 'annotation';
  message: infer M extends AnnotationRunRequest;
}
  ? AnnotationRunResult[M['action']]
  : T extends { operation: 'digest' } & AdmittedCall
    ? DigestResult<T['message']>
    : T extends { operation: 'action' }
      ? CallEditorState
      : T extends { operation: 'submit' }
        ? ReadingResult<'submit'>
        : void;

export function runnerRequest<K extends RunnerDbType>(
  message: RunnerDbRequest<K>,
): Promise<DbOperations[K]['result']>;
export function runnerRequest<T extends RunnerOperation>(message: T): Promise<RunnerResult<T>>;
export function runnerRequest(message: { operation: 'clear-history' }): Promise<void>;
export async function runnerRequest(
  message: RunnerOperation | RunnerDbRequest | { operation: 'clear-history' },
): Promise<unknown> {
  if (message.operation === 'delete' && !isId(message.selectionId))
    throw new Error('A record ID is required for deletion.');
  // Existing offscreen documents recognize an unqualified delete as Clear History.
  const wire: RunnerRequest =
    message.operation === 'clear-history' ? { operation: 'delete' } : message;
  await ensureOffscreenDocument();
  return request({ target: RUNNER_TARGET, ...wire });
}

function isRunnerDbType(value: string): value is RunnerDbType {
  return runnerDbRoutes.has(value);
}

function validateRunnerDbPayload(type: RunnerDbType, payload: unknown) {
  switch (type) {
    case 'DB_RESTORE_SELECTION':
    case 'DB_PURGE_SELECTION':
    case 'DB_SET_BOOKMARK':
      validateWorkspace({ type, payload });
      return;
    case 'DB_HISTORY_PAGE':
    case 'DB_ANNOTATION_URLS': {
      if (!isRecord(payload)) break;
      const { visibility, ...query } = payload;
      if (
        visibility !== undefined &&
        visibility !== 'masked' &&
        !(type === 'DB_HISTORY_PAGE' && (visibility === 'visible' || visibility === 'all'))
      )
        break;
      validateFeaturePayload(type, query);
      return;
    }
    case 'DB_DIGEST_GET':
      if (!isRecord(payload) || !isCallBatchId(payload.id)) break;
      validateFeaturePayload(type, payload);
      return;
    default:
      validateFeaturePayload(type, payload);
      return;
  }
  throw new Error('Invalid or unavailable runner operation.');
}

export function validateRunnerRequest(value: unknown): asserts value is RunnerRequest {
  if (isRecord(value)) {
    switch (value.operation) {
      case 'action':
        validateCallEditRequest(value.message);
        return;
      case 'db': {
        const command = value.message;
        if (!isRecord(command) || typeof command.type !== 'string') break;
        if (!isRunnerDbType(command.type)) throw new Error('Unknown workspace storage operation');
        validateRunnerDbPayload(command.type, command.payload);
        return;
      }
      case 'submit':
        if (typeof value.credential !== 'string') break;
        READING_HISTORY_OPERATIONS.DB_SUBMIT.input.parse(value.submission);
        return;
      case 'stop':
        if (isId(value.selectionId)) return;
        break;
      case 'delete':
        if (Object.keys(value).every((key) => key === 'target' || key === 'operation')) return;
        validateWorkspace({
          type: 'DB_DELETE_SELECTION',
          payload: {
            selectionId: value.selectionId,
            expectedRevision: value.expectedRevision,
            stopRunId: value.stopRunId,
          },
        });
        return;
      case 'digest': {
        const request = value.message;
        if (
          !isRecord(request) ||
          (value.credential !== undefined && typeof value.credential !== 'string')
        )
          break;
        if (request.action === 'start' || request.action === 'resolve') {
          if (!isCallBatchId(request.id) || !isRecord(value.snapshot)) break;
          if (request.action === 'start') {
            if (
              typeof value.credential !== 'string' ||
              (request.regenerate !== undefined && typeof request.regenerate !== 'boolean')
            )
              break;
            callSchemas.batch.parse(value.snapshot);
          } else {
            if (value.credential !== undefined) break;
            callSchemas.lookup.parse(value.snapshot);
          }
          return;
        }
        if (value.snapshot !== undefined) break;
        validateCallControl(request);
        return;
      }
      case 'annotation': {
        const request = value.message;
        if (!isRecord(request)) break;
        if (request.action !== 'respond' && value.prepared !== undefined) break;
        if (request.action === 'stop' && annotationIdSchema.safeParse(request.id).success) return;
        if (
          request.action === 'attempts' &&
          (request.id === undefined || annotationIdSchema.safeParse(request.id).success) &&
          (request.annotationId === undefined ||
            annotationIdSchema.safeParse(request.annotationId).success)
        )
          return;
        if (
          request.action === 'respond' &&
          pageUrl.safeParse(request.url).success &&
          Array.isArray(request.targets) &&
          request.targets.every((target) => reviewedAnnotationSchema.safeParse(target).success) &&
          typeof request.presetId === 'string' &&
          typeof request.textOnly === 'boolean' &&
          typeof request.current === 'boolean' &&
          (request.currentText === undefined || typeof request.currentText === 'string') &&
          (request.callRevision === undefined || typeof request.callRevision === 'string') &&
          isRecord(value.prepared) &&
          typeof value.prepared.credential === 'string' &&
          frozenModel.safeParse(value.prepared.choices).success
        )
          return;
        break;
      }
    }
  }
  throw new Error('Invalid or unavailable runner operation.');
}
