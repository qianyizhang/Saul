import { z } from 'zod';
import { isRecord } from '../model/value.mts';
import type { DbRequest, DbType } from './history-types.ts';
import {
  READING_HISTORY_OPERATIONS,
  readingContext,
  readingSnapshot,
  savedReadingInput,
} from './reading-history.mts';
import {
  annotationIdSchema,
  annotationReplySchema,
  scopeSchema,
  pageUrl,
  requestSchema,
  validAnnotationResult,
  type AnnotationOperation,
} from './annotations.ts';
import { annotationStatusSchema } from './annotation-attempts.ts';
import { callSchemas, annotationSchemas } from './history-feature-schemas.mts';

const id = z.string().min(1);
const integer = z.number().int().nonnegative();
const text = z.string();
const empty = z.undefined();
const mediaType = z.enum(['image/png', 'image/gif']);
const image = z.strictObject({ data: z.base64().min(4).max(28_000_000), mediaType });
const selection = { selectionId: id };
const run = { ...selection, runId: id.optional() };
const filters = {
  limit: integer.optional(),
  searchQuery: text.max(1000).optional(),
  bookmarksOnly: z.boolean().optional(),
};
const visibility = z.enum(['visible', 'masked', 'all']);
const checkRun = z.object({
  id,
  status: z.enum([
    'queued',
    'running',
    'saving',
    'completed',
    'failed',
    'interrupted',
    'cancelled',
  ]),
  responseRaw: text,
  model: text,
  provider: text,
  createdAt: integer,
  maskedAt: integer.optional(),
  latencyMs: z.number().nonnegative().optional(),
  viewedAt: integer.optional(),
  error: text.optional(),
  reason: text.optional(),
  hasImage: z.boolean().optional(),
  capability: z.enum(['write', 'draw', 'speak']).optional(),
  recipe: z.object({ id, name: text }).optional(),
  preset: z.object({ id, name: text }).optional(),
  inspection: savedReadingInput
    .pick({ systemPrompt: true, userPrompt: true, context: true, followUpQuestion: true })
    .optional(),
});
const presentation = {
  latest: checkRun,
  completed: checkRun.optional(),
  bookmarked: z.boolean(),
  unread: z.boolean(),
};
const libraryItem = z.object({
  ...presentation,
  ...selection,
  selectedText: text,
  pageTitle: text,
  pageUrl: text,
  responseRaw: text,
  model: text,
  provider: text,
  createdAt: integer,
  latencyMs: z.number().nonnegative().optional(),
  hasImage: z.boolean().optional(),
  maskedAt: integer.optional(),
  revision: integer.optional(),
});
const passage = z.object({
  ...presentation,
  snapshot: readingSnapshot,
  revision: integer.optional(),
});
export type HistoryOperationPolicy = 'read' | 'repeatable-write' | 'explicit-write';
type ReadKind = 'list' | 'get' | 'entries' | 'attachment';
type Operation = {
  name: string;
  kind: ReadKind | 'commit';
  policy: HistoryOperationPolicy;
  input: z.ZodType;
  result: z.ZodType;
};
const read = (kind: ReadKind, name: string, input: z.ZodType, result: z.ZodType): Operation => ({
  kind,
  name,
  input,
  result,
  policy: 'read',
});
const commit = (
  name: string,
  input: z.ZodType,
  result: z.ZodType,
  policy: HistoryOperationPolicy = 'repeatable-write',
): Operation => ({ kind: 'commit', name, input, result, policy });
const LIFE = {
  DB_DELETE_SELECTION: { kind: 'mask', collection: 'library' },
  DB_RESTORE_SELECTION: { kind: 'restore', collection: 'library' },
  DB_PURGE_SELECTION: { kind: 'purge', collection: 'library' },
  DB_DIGEST_DELETE: { kind: 'mask', collection: 'calls' },
  DB_CLEAR_HISTORY: { kind: 'clear', collection: 'library' },
} as const;
type LifecycleType = keyof typeof LIFE;

// Feature-local names and shapes travel through the four read operations and one writer.
const OPERATIONS = {
  DB_DIGEST_ITEMS_PAGE: read(
    'entries',
    'calls.items',
    z.strictObject({ id, limit: integer.optional(), cursor: id.optional() }),
    z.strictObject({ items: callSchemas.item.array(), cursor: id.optional() }),
  ),
  DB_READING_ATTEMPTS_PAGE: read(
    'entries',
    'reading.attempts',
    z.strictObject({ ...selection, limit: integer.optional(), cursor: id.optional() }),
    z.strictObject({ items: checkRun.array(), cursor: id.optional() }),
  ),
  DB_ANNOTATION_ACTIVITY: read(
    'entries',
    'annotations.activity',
    z.strictObject({
      annotationId: annotationIdSchema,
      limit: integer.optional(),
      cursor: id.optional(),
    }),
    z.strictObject({ items: annotationSchemas.attempt.array(), cursor: id.optional() }),
  ),
  DB_ANNOTATION_CONVERSATION: read(
    'entries',
    'annotations.conversation',
    z.strictObject({
      scope: scopeSchema,
      id: annotationIdSchema,
      limit: integer.optional(),
      cursor: id.optional(),
    }),
    z.strictObject({ items: annotationReplySchema.array(), cursor: id.optional() }),
  ),
  DB_ANNOTATION: commit(
    'annotations.change',
    requestSchema.safeExtend({ external: z.literal(true).optional() }),
    z.custom(validAnnotationResult),
    'explicit-write',
  ),
  DB_ANNOTATION_IMAGE: commit(
    'annotations.capture',
    z.strictObject({ id: annotationIdSchema, image: text.optional(), error: text.optional() }),
    empty,
  ),
  DB_ANNOTATION_ATTEMPT: commit(
    'annotations.attempt',
    annotationSchemas.attemptOperation,
    annotationSchemas.attempt.array(),
    'explicit-write',
  ),
  DB_ANNOTATION_STATUS: read(
    'get',
    'annotations.editor',
    annotationStatusSchema,
    annotationSchemas.editor,
  ),
  DB_ANNOTATION_URLS: read(
    'list',
    'annotations.urls',
    z.strictObject({ url: pageUrl }),
    text.array(),
  ),
  DB_IMAGE: read('attachment', 'library.image', z.strictObject(run), image.optional()),
  DB_IMAGE_CHUNK: commit(
    'reading.image-transfer',
    z.strictObject({
      runId: id,
      offset: integer,
      data: text.max(200_000).regex(/^[A-Za-z0-9+/]*={0,2}$/),
      mediaType,
      last: z.boolean(),
    }),
    empty,
  ),
  DB_READING_RESOLVE: commit(
    'reading.reuse',
    z.strictObject({ snapshot: readingSnapshot, submissionId: id, recipeId: id }),
    id.optional(),
  ),
  DB_RECOVER: commit('reading.recover', empty, empty),
  DB_PAGE: read('list', 'reading.page', z.strictObject({ url: id }), passage.array()),
  DB_PASSAGE: read('get', 'reading.passage', z.strictObject(selection), passage.optional()),
  DB_CONTEXT: read('get', 'reading.context', z.strictObject(run), readingContext),
  DB_INPUT: read('get', 'reading.frozen-input', z.strictObject(run), savedReadingInput.optional()),
  DB_RUNS: read('entries', 'reading.legacy-attempts', z.strictObject(selection), checkRun.array()),
  DB_VIEW: commit('reading.viewed', z.strictObject({ ...selection, runId: id }), empty),
  DB_UNREAD: read('list', 'library.unread', empty, integer),
  DB_GET_HISTORY: read(
    'list',
    'library.legacy-list',
    z.strictObject({ ...filters, offset: integer.optional() }),
    libraryItem.array(),
  ),
  DB_HISTORY_PAGE: read(
    'list',
    'library.records',
    z.strictObject({ ...filters, cursor: id.optional() }),
    z.strictObject({ items: libraryItem.array(), cursor: id.optional() }),
  ),
  DB_SET_BOOKMARK: commit(
    'library.bookmark',
    z.strictObject({ ...selection, bookmarked: z.boolean() }),
    empty,
    'explicit-write',
  ),
  DB_EXPORT_MARKDOWN: read('list', 'library.markdown', empty, text),
  DB_DIGEST_FIND: read(
    'list',
    'calls.reusable',
    z.strictObject({
      urls: id.array(),
      actionRevision: id.optional(),
      actionPresetId: id.optional(),
    }),
    callSchemas.batch.optional(),
  ),
  DB_DIGEST_ACTION_REVISIONS: read('list', 'calls.action-revisions', empty, text.array()),
  DB_DIGEST_CREATE: commit('calls.create', callSchemas.batch, callSchemas.batch),
  DB_DIGEST_GET: read('get', 'calls.run', z.strictObject({ id }), callSchemas.batch),
  DB_DIGEST_RETRY: commit('calls.retry', z.strictObject({ id }), callSchemas.batch),
  DB_DIGEST_INTERRUPT: commit(
    'calls.interrupt',
    z.strictObject({ id, error: text }),
    callSchemas.batch,
  ),
  DB_DIGEST_LIST: read('list', 'calls.runs', empty, callSchemas.overview.array()),
  DB_DIGEST_ITEM: commit(
    'calls.update-item',
    z.strictObject({ id, item: callSchemas.item, source: callSchemas.source.optional() }),
    empty,
  ),
  DB_DIGEST_SOURCE: read(
    'attachment',
    'calls.source',
    z.strictObject({ id, index: integer }),
    callSchemas.source.optional(),
  ),
  DB_DIGEST_RECOVER: commit('calls.recover', empty, empty),
  DB_SUBMIT: commit(
    'reading.submit',
    READING_HISTORY_OPERATIONS.DB_SUBMIT.input,
    READING_HISTORY_OPERATIONS.DB_SUBMIT.result,
  ),
  DB_CLAIM: commit(
    'reading.claim',
    READING_HISTORY_OPERATIONS.DB_CLAIM.input,
    READING_HISTORY_OPERATIONS.DB_CLAIM.result,
  ),
  DB_SAVING: commit(
    'reading.saving',
    READING_HISTORY_OPERATIONS.DB_SAVING.input,
    READING_HISTORY_OPERATIONS.DB_SAVING.result,
  ),
  DB_CHECKPOINT: commit(
    'reading.checkpoint',
    READING_HISTORY_OPERATIONS.DB_CHECKPOINT.input,
    READING_HISTORY_OPERATIONS.DB_CHECKPOINT.result,
  ),
  DB_FINISH: commit(
    'reading.finish',
    READING_HISTORY_OPERATIONS.DB_FINISH.input,
    READING_HISTORY_OPERATIONS.DB_FINISH.result,
  ),
} satisfies Record<Exclude<DbType, LifecycleType>, Operation>;

type FeatureType = keyof typeof OPERATIONS;
const features = Object.entries(OPERATIONS) as [FeatureType, Operation][];
const annotationViews = {
  'annotations.records': 'DB_ANNOTATION',
  'annotations.record': 'DB_ANNOTATION',
  'annotations.image': 'DB_ANNOTATION',
  'annotations.legacy-activity': 'DB_ANNOTATION_ATTEMPT',
} as const;
const byName = new Map<string, FeatureType>([
  ...features.map(([type, operation]): [string, FeatureType] => [operation.name, type]),
  ...Object.entries(annotationViews),
]);
const collection = z.enum(['library', 'calls', 'annotations']);
const revision = integer.nullable().optional();
const target = z.strictObject({ collection, id, entryId: id.optional() });
const identity = z.uuid();
const commandSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.enum(['list', 'get', 'entries', 'attachment']),
    view: id,
    query: z.unknown().optional(),
    visibility: visibility.optional(),
  }),
  z.strictObject({
    kind: z.literal('commit'),
    change: id,
    input: z.unknown().optional(),
    target: target.optional(),
    expectedRevision: revision,
  }),
  z.strictObject({
    kind: z.enum(['mask', 'restore', 'purge']),
    target,
    expectedRevision: revision,
  }),
  z.strictObject({ kind: z.literal('clear'), collection }),
]);
const requestSchemaV1 = z.strictObject({
  operation: z.literal('history'),
  owner: identity,
  operationId: identity,
  command: commandSchema,
});
export type HistoryRequest = z.infer<typeof requestSchemaV1>;

function annotationRead(
  type: FeatureType,
  payload: unknown,
): { kind: ReadKind; name: string } | undefined {
  if (!isRecord(payload)) return undefined;
  if (type === 'DB_ANNOTATION' && isRecord(payload.operation)) {
    if (payload.operation.action === 'list') return { kind: 'list', name: 'annotations.records' };
    if (payload.operation.action === 'read')
      return payload.operation.image
        ? { kind: 'attachment', name: 'annotations.image' }
        : { kind: 'get', name: 'annotations.record' };
  }
  if (type === 'DB_ANNOTATION_ATTEMPT' && payload.action === 'read')
    return { kind: 'entries', name: 'annotations.legacy-activity' };
  return undefined;
}

function projectedQuery(message: DbRequest): {
  query: unknown;
  visibility?: z.infer<typeof visibility>;
} {
  switch (message.type) {
    case 'DB_HISTORY_PAGE':
    case 'DB_ANNOTATION_STATUS':
    case 'DB_ANNOTATION_URLS': {
      const { visibility, ...query } = message.payload;
      return { query, visibility };
    }
    case 'DB_ANNOTATION': {
      const { operation, ...request } = message.payload;
      if (operation.action === 'list' && operation.filter === 'deleted')
        return { query: message.payload, visibility: 'masked' };
      if (operation.action !== 'read') break;
      const { visibility, ...query } = operation;
      return { query: { ...request, operation: query }, visibility };
    }
  }
  return { query: message.payload };
}

function featureOperation(command: HistoryRequest['command']) {
  if (!('view' in command || 'change' in command)) return undefined;
  const reading = 'view' in command;
  const name = reading ? command.view : command.change;
  const type = byName.get(name);
  if (!type) throw new Error('Unsupported History view or change.');
  const operation = OPERATIONS[type];
  const payload = reading ? command.query : command.input;
  const route = annotationRead(type, payload) ?? operation;
  if (
    route.kind !== command.kind ||
    route.name !== name ||
    !operation.input.safeParse(payload).success
  )
    throw new Error(`Invalid History request for ${operation.name}.`);
  return { type, payload, operation };
}

export function createHistoryRequest(
  owner: string,
  operationId: string,
  message: DbRequest,
): HistoryRequest {
  let command: HistoryRequest['command'];
  switch (message.type) {
    case 'DB_CLEAR_HISTORY':
      command = LIFE[message.type];
      break;
    case 'DB_DIGEST_DELETE':
      command = { kind: 'mask', target: { collection: 'calls', id: message.payload.id } };
      break;
    case 'DB_DELETE_SELECTION':
    case 'DB_RESTORE_SELECTION':
    case 'DB_PURGE_SELECTION':
      command = {
        kind: LIFE[message.type].kind,
        target: { collection: 'library', id: message.payload.selectionId },
        expectedRevision: message.payload.expectedRevision,
      };
      break;
    case 'DB_SET_BOOKMARK': {
      const { expectedRevision, ...input } = message.payload;
      command = {
        kind: 'commit',
        change: OPERATIONS.DB_SET_BOOKMARK.name,
        input,
        target: { collection: 'library', id: input.selectionId },
        expectedRevision,
      };
      break;
    }
    default: {
      const operation = OPERATIONS[message.type];
      const { kind, name } = annotationRead(message.type, message.payload) ?? operation;
      command =
        kind === 'commit'
          ? { kind, change: name, input: message.payload }
          : { kind, view: name, ...projectedQuery(message) };
    }
  }
  return { operation: 'history', owner, operationId, command };
}

export function decomposeHistoryCommand(command: HistoryRequest['command']): DbRequest | undefined {
  const feature = featureOperation(command);
  if (!feature) return undefined;
  const { type, payload } = feature;
  return { type, payload } as DbRequest;
}

export function historyRequestPolicy(request: HistoryRequest): HistoryOperationPolicy {
  if ('view' in request.command) return 'read';
  return featureOperation(request.command)?.operation.policy ?? 'explicit-write';
}

export function validateHistoryResult(request: HistoryRequest, event: unknown): void {
  const feature = featureOperation(request.command);
  const validEnvelope = isRecord(event) && event.type === 'result' && Object.hasOwn(event, 'value');
  const writing = !('view' in request.command);
  const value = validEnvelope ? (event.value ?? undefined) : undefined;
  const annotation =
    feature?.type === 'DB_ANNOTATION'
      ? (feature.payload as { operation: AnnotationOperation }).operation
      : undefined;
  if (
    !validEnvelope ||
    (event.revision !== undefined && !integer.safeParse(event.revision).success) ||
    (feature
      ? annotation
        ? !validAnnotationResult(value, annotation)
        : !feature.operation.result.safeParse(value).success
      : value !== undefined || !integer.safeParse(event.revision).success)
  ) {
    throw new Error(
      `Saul History returned an invalid reply.${writing ? ' The write may have been applied. Refresh the affected History view before trying again.' : ''}`,
    );
  }
}

export function validateHistoryRequest(value: unknown): asserts value is HistoryRequest {
  const parsed = requestSchemaV1.safeParse(value);
  if (!parsed.success) throw new Error('Invalid History request.');
  const { command } = parsed.data;
  featureOperation(command);
  if (command.kind === 'commit' && command.expectedRevision !== undefined && !command.target)
    throw new Error('A record target is required for a revision check.');
}
