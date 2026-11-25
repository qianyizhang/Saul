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
const pair = z.object({ en: text, zh: text });
const summary = z.object({
  lead: pair,
  points: pair.array(),
  caution: pair.nullable(),
  flow: pair.array(),
  terms: pair.array(),
  question: pair.nullable(),
});
const callRevision = z.object({
  contractVersion: z.literal(1),
  name: text,
  description: text,
  language: z.enum(['javascript', 'typescript']),
  source: text,
  revision: id,
  createdAt: integer,
  approved: bool.optional(),
});
const responseCall = { instructions: text, input: text, complete: bool };
const item = z.object({
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
  calls: z
    .object({ ...responseCall, output: text })
    .array()
    .optional(),
});
const overview = z.object({
  maskedAt: integer.optional(),
  id,
  title: text.optional(),
  windowTitle: text,
  createdAt: integer,
});
const batch = overview
  .extend({
    windowId: z.number().int(),
    pdfProcessing: z.enum(['attachment', 'local']).optional(),
    accountId: text.optional(),
    connectionKey: text.optional(),
    credentialOwner: z.enum(['local', 'saul']).optional(),
    model: text.optional(),
    effort: text.optional(),
    error: text.optional(),
    items: item.array(),
  })
  .and(
    z.union([
      z.object({
        action: z.object({ revision: callRevision, presetId: id, input: frozenModel.optional() }),
        summaryInput: z.undefined().optional(),
        prompt: text.optional(),
      }),
      z.object({
        action: z.undefined().optional(),
        summaryInput: frozenModel.optional(),
        prompt: text,
      }),
    ]),
  );
const source = z
  .object({
    title: text.optional(),
    capturedAt: integer,
    truncated: bool,
    coverage: text,
  })
  .and(
    z.union([
      z.object({
        kind: z.literal('pdf-url'),
        attachment: z.custom<PdfUrlAttachment>(validPdfUrlAttachment),
      }),
      z.object({ kind: z.literal('text').optional(), text }),
    ]),
  );
export const callSchemas = { item, overview, batch, source };
const attempt = z.object({
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
  calls: z
    .object({ ...responseCall, raw: text })
    .array()
    .optional(),
  error: text.optional(),
  callRevision: id.optional(),
  currentText: text.optional(),
});
const attemptOperation = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('admit'), attempts: attempt.array().min(1) }),
  z.strictObject({ action: z.literal('save'), attempt }),
  z.strictObject({ action: z.literal('complete'), attempt, revision: integer }),
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
