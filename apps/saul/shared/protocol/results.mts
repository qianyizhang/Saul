import { TOOL_OPERATIONS, type ToolArgs, type ToolName, type ToolResults } from './protocol.mts';

export function validateToolResult<K extends ToolName>(
  name: K,
  value: unknown,
  args?: ToolArgs[K],
): ToolResults[K] {
  const operation = TOOL_OPERATIONS[name];
  if (
    !operation.output.safeParse(value).success ||
    ('matchesRequest' in operation &&
      !operation.matchesRequest(value, args as ToolArgs['saul_annotations'] | undefined))
  )
    throw new Error(`Invalid browser result for ${name}`);
  // Validation does not strip extension metadata from a browser reply.
  return value as ToolResults[K];
}
