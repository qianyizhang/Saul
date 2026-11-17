import { z } from 'zod';

/** JSON messages cannot contain undefined; reject explicit undefined at local callers too. */
export function wireObject<const Shape extends z.ZodRawShape>(shape: Shape) {
  return z.strictObject(shape).superRefine((value, context) => {
    for (const [key, item] of Object.entries(value))
      if (item === undefined)
        context.addIssue({ code: 'custom', path: [key], message: 'Omit absent arguments.' });
  });
}

export const integer = z.number().int();
export const id = integer.min(0);
export function ids(maximum = 1000, minimum = 1) {
  return z
    .array(id)
    .min(minimum)
    .max(maximum)
    .refine((values) => new Set(values).size === values.length, 'Duplicate IDs.')
    .meta({ uniqueItems: true });
}
export const session = z.string().regex(/^[a-f0-9]{16}$/);
/** The emitted catalog is plain JSON, not a public dependency on Zod's internal JSON-schema types. */
export interface ToolSchema {
  type?: string;
  properties?: Record<string, ToolSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: ToolSchema;
  [keyword: string]: unknown;
}
export interface ObjectToolSchema extends ToolSchema {
  type: 'object';
  properties: Record<string, ToolSchema>;
  required: string[];
  additionalProperties: false;
}

export function inputSchema(schema: z.ZodType): ObjectToolSchema {
  // Preserve the existing annotation catalog's explicit default fields. Other
  // argument defaults are metadata only and never change parsed requests.
  const { $schema, ...definition } = z.toJSONSchema(schema);
  void $schema;
  return { ...definition, required: definition.required ?? [] } as ObjectToolSchema;
}
export function parseArguments<T extends z.ZodType>(
  schema: T,
  value: unknown,
  name: string,
): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(`${name}: ${parsed.error.message}`);
  return parsed.data;
}
