/** Narrow external values before reading properties. Shared by browser and Node boundaries. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

export function isId(value: unknown): value is string {
  return isBoundedText(value, 128) && value.length > 0;
}

export function errorCode(value: unknown): unknown {
  return isRecord(value) ? value.code : undefined;
}
