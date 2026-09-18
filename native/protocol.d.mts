export const HOST_NAME: string;
export const MAX_MESSAGE: number;
export const TOOLS: Array<{
  name: string;
  description: string;
  inputSchema: object;
  annotations: object;
}>;
export function validateCall(name: string, args?: Record<string, unknown>): Record<string, unknown>;
