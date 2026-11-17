import type { ToolSchema } from './protocol.mts';
import { eventDefinition, uuidSchema, objectSchema } from './diagnostic-events.mts';
const diagnosticTool = (
  name: string,
  description: string,
  inputSchema: ToolSchema,
  readOnly = true,
) => ({
  name,
  description,
  inputSchema,
  annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false },
  _meta: { ui: { visibility: ['app'] } },
});
export const DIAGNOSTIC_TOOLS = [
  diagnosticTool(
    'diagnostics_info',
    'Build, recording health, canonical log path and retention; no payloads.',
    objectSchema({}),
  ),
  diagnosticTool(
    'diagnostics_tools',
    'Catalog generated from every registered MCP tool.',
    objectSchema({}),
  ),
  diagnosticTool(
    'diagnostics_append',
    'Record one bounded app observation. App-origin evidence is untrusted; automatic disk recording contains metadata only.',
    objectSchema({ event: eventDefinition }),
    false,
  ),
  diagnosticTool(
    'diagnostics_events',
    'At most 20 server observation summaries, without payload bodies.',
    objectSchema(
      {
        limit: { type: 'integer', enum: Array.from({ length: 20 }, (_, i) => i + 1) },
        interaction: uuidSchema,
      },
      [],
    ),
  ),
  diagnosticTool(
    'diagnostics_event',
    'Read one frozen live observation by event ID; never reruns its action.',
    objectSchema({ id: uuidSchema }),
  ),
  diagnosticTool(
    'diagnostics_capture',
    'Explicitly save retained masked payloads for exactly one selected interaction.',
    objectSchema({ interaction: uuidSchema }),
    false,
  ),
];
