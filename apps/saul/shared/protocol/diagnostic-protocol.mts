import { eventSchema, uuidSchema } from './diagnostic-events.mts';
import { integer, wireObject, inputSchema, parseArguments } from './tool-schema.mts';
export const DIAGNOSTIC_OPERATIONS = {
  diagnostics_info: {
    description: 'Build, recording health, canonical log path and retention; no payloads.',
    input: wireObject({}),
    readOnly: true,
  },
  diagnostics_tools: {
    description: 'Catalog generated from every registered MCP tool.',
    input: wireObject({}),
    readOnly: true,
  },
  diagnostics_append: {
    description:
      'Record one bounded app observation. App-origin evidence is untrusted; automatic disk recording contains metadata only.',
    input: wireObject({ event: eventSchema }),
    readOnly: false,
  },
  diagnostics_events: {
    description: 'At most 20 server observation summaries, without payload bodies.',
    input: wireObject({
      limit: integer
        .refine((n) => n >= 1 && n <= 20)
        .meta({ enum: Array.from({ length: 20 }, (_, i) => i + 1) })
        .optional(),
      interaction: uuidSchema.optional(),
    }),
    readOnly: true,
  },
  diagnostics_event: {
    description: 'Read one frozen live observation by event ID; never reruns its action.',
    input: wireObject({ id: uuidSchema }),
    readOnly: true,
  },
  diagnostics_capture: {
    description: 'Explicitly save retained masked payloads for exactly one selected interaction.',
    input: wireObject({ interaction: uuidSchema }),
    readOnly: false,
  },
} as const;
export const DIAGNOSTIC_TOOLS = (
  Object.keys(DIAGNOSTIC_OPERATIONS) as (keyof typeof DIAGNOSTIC_OPERATIONS)[]
).map((name) => {
  const operation = DIAGNOSTIC_OPERATIONS[name];
  return {
    name,
    description: operation.description,
    inputSchema: inputSchema(operation.input),
    annotations: { readOnlyHint: operation.readOnly, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ['app'] } },
  };
});
export function validateDiagnosticCall(name: string, args: unknown) {
  if (!Object.hasOwn(DIAGNOSTIC_OPERATIONS, name)) throw new Error('Unknown diagnostic operation');
  return parseArguments(
    DIAGNOSTIC_OPERATIONS[name as keyof typeof DIAGNOSTIC_OPERATIONS].input,
    args,
    name,
  );
}
