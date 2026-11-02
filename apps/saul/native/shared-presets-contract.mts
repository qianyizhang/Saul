import { isRecord } from './value.mts';
export interface SharedPreset {
  id: string;
  name: string;
  model: string;
  effort: string;
  fast: boolean;
}
export interface SharedPresets {
  revision: number;
  presets: SharedPreset[];
}
export function validateSharedPresets(value: unknown): asserts value is SharedPreset[] {
  if (
    !Array.isArray(value) ||
    value.length > 128 ||
    !value.every(
      (p) =>
        isRecord(p) &&
        Object.keys(p).length === 5 &&
        typeof p.id === 'string' &&
        /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(p.id) &&
        typeof p.name === 'string' &&
        !!p.name.trim() &&
        p.name.length <= 80 &&
        typeof p.model === 'string' &&
        p.model.length <= 256 &&
        typeof p.effort === 'string' &&
        p.effort.length <= 64 &&
        typeof p.fast === 'boolean',
    ) ||
    new Set(value.map((p: SharedPreset) => p.id.toLowerCase())).size !== value.length ||
    new Set(value.map((p: SharedPreset) => p.name.trim().toLowerCase())).size !== value.length
  )
    throw new Error('Shared presets need unique IDs and names, a model, effort, and speed.');
}

export interface ScopedConfig {
  revision: number;
  value?: Record<string, unknown>;
}
export function validScopedConfig(v: unknown): v is ScopedConfig {
  return (
    isRecord(v) &&
    Number.isSafeInteger(v.revision) &&
    Number(v.revision) >= 0 &&
    (v.value === undefined || isRecord(v.value))
  );
}

// Leave room for native framing and the result envelope within the 1 MiB transport.
export const MAX_SCOPED_CONFIG_BYTES = 750_000;
export function validateScopedConfigValue(
  value: unknown,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Scoped configuration must be an object.');
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_SCOPED_CONFIG_BYTES)
    throw new Error(
      'Scoped configuration exceeds 750 KB. Keep fewer or smaller call presets and recipes.',
    );
}
