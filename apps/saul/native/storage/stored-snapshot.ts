import { isDeepStrictEqual } from 'node:util';
import type { z } from 'zod';

// Read views can ignore fields added by a newer writer. Whole-snapshot replacement
// requires a lossless decode, including nested fields that a schema would strip.
export function writableSnapshot<T>(schema: z.ZodType<T>, serialized: string): T {
  const original: unknown = JSON.parse(serialized);
  const checked = schema.safeParse(original);
  if (!checked.success || !isDeepStrictEqual(original, checked.data))
    throw new Error('This saved History payload requires a newer writer. Its data was retained.');
  return checked.data;
}
