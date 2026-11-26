import { z } from 'zod';
import { validPdfUrlAttachment, type PdfUrlAttachment } from './credential-plan.mts';
import { annotationIdSchema, annotationRecordSchema, pageUrl } from './annotations.ts';
import { savedReadingInput } from './reading-history.mts';

const id = z.string().min(1);
const text = z.string();
const integer = z.number().int().nonnegative();
const bool = z.boolean();
const frozenModel = savedReadingInput.omit({
  systemPrompt: true,
  userPrompt: true,
  followUpQuestion: true,
  context: true,
  recipe: true,
});
const modelRequest = frozenModel.extend({ systemPrompt: text, userPrompt: text });
const terminal = ['completed', 'failed', 'interrupted', 'cancelled'] as const;
const statuses = z.enum(['queued', 'running', 'saving', ...terminal]);
const responseCall = { instructions: text, input: text, complete: bool };

// Commands reject unknown fields. Stored results keep their existing compatibility.
function objectPolicy(strict: boolean) {
  return <S extends z.ZodRawShape>(shape: S) => (strict ? z.strictObject(shape) : z.object(shape));
}

function callHistorySchemas(strict: boolean) {
  const object = objectPolicy(strict);
  const pair = object({ en: text, zh: text });
  const summary = object({
    lead: pair,
    points: pair.array(),
    caution: pair.nullable(),
    flow: pair.array(),
    terms: pair.array(),
    question: pair.nullable(),
  });
  const callRevision = object({
    contractVersion: z.literal(1),
    name: text,
    description: text,
    language: z.enum(['javascript', 'typescript']),
    source: text,
    revision: id,
    createdAt: integer,
    approved: bool.optional(),
  });
  const item = object({
    maskedAt: integer.optional(),
    index: integer,
    tabId: z.number().int(),
    windowId: z.number().int().optional(),
    windowTitle: text.optional(),
    title: text,
    url: id,
    status: z.enum(['queued', 'capturing', 'running', 'saving', 'skipped', ...terminal]),
    raw: text,
    summary: summary.optional(),
    error: text.optional(),
    coverage: text.optional(),
    truncated: bool.optional(),
    capturedAt: integer.optional(),
    sourceKind: z.literal('pdf-url').optional(),
    finalText: text.optional(),
    progress: text.optional(),
    calls: object({ ...responseCall, output: text })
      .array()
      .optional(),
  });
  const overviewFields = {
    maskedAt: integer.optional(),
    id,
    title: text.optional(),
    windowTitle: text,
    createdAt: integer,
  };
  const batchFields = {
    ...overviewFields,
    windowId: z.number().int(),
    pdfProcessing: z.enum(['attachment', 'local']).optional(),
    accountId: text.optional(),
    connectionKey: text.optional(),
    credentialOwner: z.enum(['local', 'saul']).optional(),
    model: text.optional(),
    effort: text.optional(),
    error: text.optional(),
    items: item.array(),
  };
  const batch = z.union([
    object({
      ...batchFields,
      action: object({ revision: callRevision, presetId: id, input: frozenModel.optional() }),
      summaryInput: z.undefined().optional(),
      prompt: text.optional(),
    }),
    object({
      ...batchFields,
      action: z.undefined().optional(),
      summaryInput: frozenModel.optional(),
      prompt: text,
    }),
  ]);
  const sourceFields = {
    title: text.optional(),
    capturedAt: integer,
    truncated: bool,
    coverage: text,
  };
  const source = z.discriminatedUnion('kind', [
    object({
      ...sourceFields,
      kind: z.literal('pdf-url'),
      attachment: z.custom<PdfUrlAttachment>(validPdfUrlAttachment),
    }),
    object({ ...sourceFields, kind: z.literal('text').optional(), text }),
  ]);
  return { item, overview: object(overviewFields), batch, source };
}
export const callSchemas = callHistorySchemas(false);
export const callWriteSchemas = callHistorySchemas(true);

function attemptSchema(strict: boolean) {
  const object = objectPolicy(strict);
  return object({
    id,
    annotationId: annotationIdSchema,
    url: pageUrl,
    revision: integer,
    status: statuses,
    createdAt: integer,
    maskedAt: integer.optional(),
    input: modelRequest,
    evidence: text,
    image: text.optional(),
    raw: text,
    calls: object({ ...responseCall, raw: text })
      .array()
      .optional(),
    error: text.optional(),
    callRevision: id.optional(),
    currentText: text.optional(),
  });
}
const attempt = attemptSchema(false);
const attemptWrite = attemptSchema(true);
const attemptOperation = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('admit'), attempts: attemptWrite.array().min(1) }),
  z.strictObject({ action: z.literal('save'), attempt: attemptWrite }),
  z.strictObject({ action: z.literal('complete'), attempt: attemptWrite, revision: integer }),
  z.strictObject({
    action: z.literal('read'),
    id: id.optional(),
    annotationId: annotationIdSchema.optional(),
  }),
  z.strictObject({ action: z.literal('recover') }),
]);
const editor = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('missing') }),
  z.object({
    kind: z.literal('found'),
    key: z.object({ revision: integer, capture: z.enum(['available', 'unavailable', 'none']) }),
    record: annotationRecordSchema
      .omit({ image: true, imageError: true, operations: true })
      .optional(),
    capture: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('none') }),
        z.object({ kind: z.literal('available'), image: text }),
        z.object({ kind: z.literal('unavailable'), error: text }),
      ])
      .optional(),
    attempts: z
      .object({ id, status: statuses, presetName: text.optional(), error: text.optional() })
      .array(),
  }),
]);
export const annotationSchemas = { attempt, attemptOperation, editor };
