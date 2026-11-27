import { z } from 'zod';

export const CHATGPT_ORIGIN = 'https://chatgpt.com';
export const CHAT_PATH_PATTERN = '^/c/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/?$';
export const DEEP_DIVE_MENU = 'saul-deep-dive';
export const DEEP_DIVE_LABEL = 'Save & deep dive';
export const DEEP_DIVE_RECORDS = 'saul_deep_dive_records';
export const DEEP_DIVE_INSTRUCTION = 'saul_deep_dive_instruction';
export const MAX_INSTRUCTION_LENGTH = 4_000;
export const DEFAULT_INSTRUCTION =
  'Read this article and help me understand it in depth. Explain its main claim, the evidence and assumptions behind it, and what remains uncertain or disputed. Suggest questions worth following up. Distinguish the article from any outside sources you use. If you cannot access the article, say so.';

export function articleUrl(value: string | undefined): string | undefined {
  const url = value && URL.parse(value);
  if (
    url &&
    ['http:', 'https:'].includes(url.protocol) &&
    !url.username &&
    !url.password &&
    url.origin !== CHATGPT_ORIGIN &&
    url.href.length <= 8_192
  )
    return url.href;
}

export function chatUrl(value: string | undefined): string | undefined {
  const url = value && URL.parse(value);
  if (
    url &&
    url.origin === CHATGPT_ORIGIN &&
    !url.username &&
    !url.password &&
    new RegExp(CHAT_PATH_PATTERN, 'i').test(url.pathname)
  )
    return url.origin + url.pathname.replace(/\/$/, '');
}

const handoff = z.discriminatedUnion('phase', [
  z.object({ phase: z.literal('opening') }),
  z.object({ phase: z.literal('sending') }),
  z.object({ phase: z.literal('draft') }),
  z.object({ phase: z.literal('uncertain') }),
  z.object({ phase: z.literal('sent'), url: z.string().refine((url) => chatUrl(url) === url) }),
]);

const record = z.object({
  id: z.uuid(),
  article: z.string().refine((url) => articleUrl(url) === url),
  title: z.string(),
  prompt: z.string(),
  createdAt: z.number(),
  handoff,
});

export const deepDiveRecords = z.array(record);
export type DeepDive = z.infer<typeof record>;
export type Handoff = DeepDive['handoff'];

export const instructionText = z.string().trim().min(1).max(MAX_INSTRUCTION_LENGTH);
export const deepDiveRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }),
  z.object({ action: z.literal('instruction') }),
  z.object({
    action: z.literal('save-instruction'),
    expected: instructionText,
    value: instructionText,
  }),
  z.object({ action: z.literal('open'), id: z.uuid() }),
  z.object({ action: z.literal('remove'), id: z.uuid() }),
]);

export type DeepDiveRequest = z.infer<typeof deepDiveRequest>;
export const DEEP_DIVE_TARGET = 'saul-deep-dives';
export type DeepDiveMessage = { target: typeof DEEP_DIVE_TARGET; message: DeepDiveRequest };
export type DeepDiveResults = {
  list: { items: DeepDive[]; error: string };
  instruction: string;
  'save-instruction': string;
  open: void;
  remove: void;
};
