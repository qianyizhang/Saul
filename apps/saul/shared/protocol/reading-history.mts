import { z } from 'zod';
import type { SelectionSnapshot } from '../model/reading.ts';
import {
  validActionCapability,
  validImageOptions,
  validSpeechOptions,
  type ActionCapability,
  type SharedImageOptions,
  type SharedSpeechOptions,
} from './shared-presets-contract.mts';

const id = z.string().min(1);
const optionalText = z.string().optional();
const offset = z.number().int().nonnegative();
const provider = z.enum(['openai-compatible', 'chatgpt-plan', 'chrome-ai']);
const credentialOwner = z.enum(['local', 'saul']).optional();
const runId = { runId: id };

export const readingSnapshot = z.strictObject({
  id,
  text: z.string(),
  page: z.strictObject({
    url: id,
    canonicalUrl: optionalText,
    title: z.string(),
    favicon: optionalText,
  }),
  anchor: z.strictObject({
    exact: z.string(),
    prefix: z.string(),
    suffix: z.string(),
    textStart: offset.optional(),
    textEnd: offset.optional(),
    domPath: optionalText,
  }),
  viewport: z.strictObject({
    x: z.number(),
    y: z.number(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
    scrollX: z.number(),
    scrollY: z.number(),
  }),
  capturedAt: offset,
}) satisfies z.ZodType<SelectionSnapshot>;

// Validate the persisted shape without applying current routing or account policy to old choices.
export const readingContext = z.strictObject({
  selection: z.string(),
  pageTitle: z.string(),
  pageUrl: z.string(),
  surroundingText: optionalText,
  paragraph: optionalText,
  heading: optionalText,
});

export const frozenReadingRecipe = z.strictObject({
  capability: z.enum(['write', 'draw']).optional(),
  id: z.string(),
  name: z.string(),
  presetId: z.string(),
  template: z.string(),
  systemPrompt: z.string(),
});

export const savedReadingInput = z.strictObject({
  provider,
  credentialOwner,
  remote: z.strictObject({
    baseUrl: z.string(),
    model: z.string(),
    temperature: z.number(),
    credentialOwner: z.literal('saul').optional(),
  }),
  local: z.strictObject({ temperature: z.number(), topK: z.number() }).optional(),
  plan: z
    .strictObject({
      accountId: z.string(),
      model: z.string(),
      effort: optionalText,
      fast: z.boolean().optional(),
    })
    .optional(),
  preset: z
    .strictObject({
      id,
      name: z.string(),
      provider,
      model: z.string(),
      profileId: optionalText,
      temperature: z.number().optional(),
      topK: z.number().optional(),
      effort: optionalText,
      fast: z.boolean().optional(),
      connectionKey: optionalText,
      capability: z.custom<ActionCapability>(validActionCapability).optional(),
      imageOptions: z.custom<SharedImageOptions>(validImageOptions).optional(),
      speechOptions: z.custom<SharedSpeechOptions>(validSpeechOptions).optional(),
      shared: z.boolean().optional(),
    })
    .optional(),
  systemPrompt: z.string(),
  userPrompt: z.string().min(1),
  followUpQuestion: optionalText,
  context: readingContext,
  recipe: frozenReadingRecipe.optional(),
});

const queuedRun = z.strictObject({ id, selectionId: id, pageUrl: id, input: savedReadingInput });

export const READING_HISTORY_OPERATIONS = {
  DB_SUBMIT: {
    policy: 'repeatable-write',
    input: z.strictObject({
      submissionId: id,
      snapshot: readingSnapshot,
      input: savedReadingInput,
      regenerate: z.boolean(),
      source: z.strictObject({ selectionId: id, runId: id, revision: offset }).optional(),
    }),
    result: z
      .strictObject({ passageId: id, run: queuedRun.optional() })
      .refine(({ passageId, run }) => !run || run.selectionId === passageId),
  },
  DB_CLAIM: {
    policy: 'repeatable-write',
    input: z.strictObject(runId),
    result: z.boolean(),
  },
  DB_SAVING: {
    policy: 'repeatable-write',
    input: z.strictObject(runId),
    result: z.boolean(),
  },
  DB_CHECKPOINT: {
    policy: 'repeatable-write',
    input: z.strictObject({ ...runId, raw: z.string() }),
    result: z.undefined(),
  },
  DB_FINISH: {
    policy: 'repeatable-write',
    input: z.strictObject({
      ...runId,
      raw: optionalText,
      status: z.enum(['completed', 'failed', 'interrupted', 'cancelled']),
      error: optionalText,
      reason: optionalText,
      latencyMs: offset,
    }),
    result: z.boolean(),
  },
} as const;

export type ReadingHistoryOperations = {
  [K in keyof typeof READING_HISTORY_OPERATIONS]: {
    payload: z.infer<(typeof READING_HISTORY_OPERATIONS)[K]['input']>;
    result: z.infer<(typeof READING_HISTORY_OPERATIONS)[K]['result']>;
  };
};
