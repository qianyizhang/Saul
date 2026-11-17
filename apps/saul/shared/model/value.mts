/** Narrow external values before reading properties. Shared by browser and Node boundaries. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function errorCode(value: unknown): unknown {
  return isRecord(value) ? value.code : undefined;
}
