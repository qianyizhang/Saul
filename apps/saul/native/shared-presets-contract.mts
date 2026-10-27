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
