import { z } from 'zod';
import { wireObject } from './tool-schema.mts';

const cursor = z.string().min(1).max(4096);
const recordId = z.string().min(1).max(1024);
const source = z.enum(['saul', 'ez']);
const timestamp = z.number().int().nonnegative();
export const historySearch = wireObject({
  query: z.string().trim().min(1).max(1000),
  limit: z.number().int().min(1).max(50).optional(),
  cursor: cursor.optional(),
});
export const historySearchResult = z.object({
  items: z
    .array(
      z.object({
        id: recordId,
        source,
        createdAt: timestamp,
        title: z.string().max(200),
        excerpt: z.string().max(320),
      }),
    )
    .max(50),
  cursor: cursor.optional(),
});
export const historyRead = wireObject({
  id: recordId,
  cursor: cursor.optional(),
  textCursor: cursor.optional(),
});
export const historyTextLimit = 32000;
export const historyReadResult = z.object({
  id: recordId,
  source,
  attemptId: z.string(),
  createdAt: timestamp,
  status: z.string(),
  prompt: z.string().max(historyTextLimit),
  answer: z.string().max(historyTextLimit),
  cursor: cursor.optional(),
  textCursor: cursor.optional(),
});
export interface LibraryToolOperations {
  DB_TOOL_HISTORY_SEARCH: {
    payload: z.infer<typeof historySearch>;
    result: z.infer<typeof historySearchResult>;
  };
  DB_TOOL_HISTORY_READ: {
    payload: z.infer<typeof historyRead>;
    result: z.infer<typeof historyReadResult>;
  };
}
