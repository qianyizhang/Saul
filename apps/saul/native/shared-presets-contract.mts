import { isRecord } from './value.mts';
export type ActionCapability = 'write' | 'draw' | 'speak';
export const SPEECH_MODEL = 'gpt-realtime-2.1-mini';
export const SPEECH_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
] as const;
export interface SharedSpeechOptions {
  voice: string;
}
export function validSpeechOptions(value: unknown): value is SharedSpeechOptions {
  return (
    isRecord(value) &&
    Object.keys(value).length === 1 &&
    typeof value.voice === 'string' &&
    SPEECH_VOICES.some((voice) => voice === value.voice)
  );
}
export interface SharedImageOptions {
  size: string;
  quality: string;
}
export function validImageOptions(value: unknown): value is SharedImageOptions {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => ['size', 'quality'].includes(key)) &&
    typeof value.size === 'string' &&
    ['1024x1024', '1536x1024', '1024x1536'].includes(value.size) &&
    typeof value.quality === 'string' &&
    ['low', 'medium', 'high'].includes(value.quality)
  );
}
export interface SharedPreset {
  id: string;
  name: string;
  model: string;
  effort: string;
  fast: boolean;
  providerKey?: string;
  capability?: ActionCapability;
  imageOptions?: SharedImageOptions;
  speechOptions?: SharedSpeechOptions;
}
export interface SharedProvider {
  key: string;
  name: string;
  kind: 'chatgpt-plan' | 'openai-api';
}
export const DEFAULT_PROVIDERS: readonly SharedProvider[] = [
  { key: 'gpt-plan', name: 'ChatGPT plan', kind: 'chatgpt-plan' },
  { key: 'openai-api', name: 'OpenAI API', kind: 'openai-api' },
];
export function providerCapabilities(provider: SharedProvider): ActionCapability[] {
  return provider.kind === 'chatgpt-plan' ? ['write'] : ['write', 'draw', 'speak'];
}
export function validateSharedProviders(value: unknown): asserts value is SharedProvider[] {
  if (
    !Array.isArray(value) ||
    value.length > 32 ||
    !value.every(
      (p) =>
        isRecord(p) &&
        Object.keys(p).every((key) => ['key', 'name', 'kind'].includes(key)) &&
        typeof p.key === 'string' &&
        /^[a-z][a-z0-9-]{0,63}$/.test(p.key) &&
        typeof p.name === 'string' &&
        !!p.name.trim() &&
        p.name.length <= 80 &&
        (p.kind === 'chatgpt-plan' || p.kind === 'openai-api'),
    ) ||
    new Set(value.map((p) => p.key)).size !== value.length ||
    new Set(value.map((p) => p.name.trim().toLowerCase())).size !== value.length
  )
    throw new Error('Providers need unique keys and names and a supported kind.');
}
export interface SharedPresets {
  revision: number;
  presets: SharedPreset[];
  /** Absent only in legacy replies; both current stores return shared definitions. */
  providers?: SharedProvider[];
}
export function validateSharedPresets(value: unknown): asserts value is SharedPreset[] {
  if (
    !Array.isArray(value) ||
    value.length > 128 ||
    !value.every(
      (p) =>
        isRecord(p) &&
        Object.keys(p).every((key) =>
          [
            'id',
            'name',
            'model',
            'effort',
            'fast',
            'providerKey',
            'capability',
            'imageOptions',
            'speechOptions',
          ].includes(key),
        ) &&
        typeof p.id === 'string' &&
        /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(p.id) &&
        typeof p.name === 'string' &&
        !!p.name.trim() &&
        p.name.length <= 80 &&
        typeof p.model === 'string' &&
        p.model.length <= 256 &&
        typeof p.effort === 'string' &&
        p.effort.length <= 64 &&
        typeof p.fast === 'boolean' &&
        (p.providerKey === undefined ||
          (typeof p.providerKey === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(p.providerKey))) &&
        (p.capability === undefined || ['write', 'draw', 'speak'].includes(String(p.capability))) &&
        (p.imageOptions === undefined || validImageOptions(p.imageOptions)) &&
        (p.speechOptions === undefined || validSpeechOptions(p.speechOptions)),
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
      'Scoped configuration exceeds 750 KB. Keep fewer or smaller call presets and actions.',
    );
}
