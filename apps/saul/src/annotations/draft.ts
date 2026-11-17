import { z } from 'zod';
import { annotationIdSchema } from './contract';
import { annotationDraftKey } from './routing';

const mutationSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('write'),
      id: annotationIdSchema,
      token: z.uuid(),
      text: z.string().max(16000),
      revision: z.number().int().positive().optional(),
    })
    .strict(),
  z.object({ action: z.literal('clear'), id: annotationIdSchema, token: z.uuid() }).strict(),
  z.object({ action: z.literal('purge'), id: annotationIdSchema }).strict(),
]);
export type AnnotationDraftMutation = z.infer<typeof mutationSchema>;

// The background owns one mutation lane for each key, across editor windows.
const pending = new Map<string, Promise<void>>();
export async function mutateAnnotationDraft(message: unknown): Promise<void> {
  const mutation = mutationSchema.parse(message);
  const key = annotationDraftKey(mutation.id);
  const next = (pending.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      if (mutation.action === 'write') {
        const { token, text, revision } = mutation;
        await chrome.storage.local.set({ [key]: { token, text, revision } });
      } else if (mutation.action === 'purge') {
        await chrome.storage.local.remove(key);
      } else {
        const current: unknown = (await chrome.storage.local.get(key))[key];
        if (
          current &&
          typeof current === 'object' &&
          'token' in current &&
          current.token === mutation.token
        )
          await chrome.storage.local.remove(key);
      }
    });
  pending.set(key, next);
  try {
    await next;
  } finally {
    if (pending.get(key) === next) pending.delete(key);
  }
}
