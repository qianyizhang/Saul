import { z } from 'zod';
import { isRecord } from '../model/value.mts';
const actionCapabilities = ['write', 'draw', 'speak'] as const;
export type ActionCapability = (typeof actionCapabilities)[number];
export const IMAGE_OPTIONS = {
  size: ['1024x1024', '1536x1024', '1024x1536'],
  quality: ['low', 'medium', 'high'],
  outputFormat: ['png', 'gif'],
} as const;
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
function supportedOption<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === 'string' && choices.some((choice) => choice === value);
}
export const validImageSize = (value: unknown) => supportedOption(value, IMAGE_OPTIONS.size);
export const validImageQuality = (value: unknown) => supportedOption(value, IMAGE_OPTIONS.quality);
export const validImageFormat = (value: unknown) =>
  supportedOption(value, IMAGE_OPTIONS.outputFormat);
export const validSpeechVoice = (value: unknown) => supportedOption(value, SPEECH_VOICES);
export const validActionCapability = (value: unknown) => supportedOption(value, actionCapabilities);
export interface SharedSpeechOptions {
  voice: string;
}
export function validSpeechOptions(value: unknown): value is SharedSpeechOptions {
  return isRecord(value) && Object.keys(value).length === 1 && validSpeechVoice(value.voice);
}
export type ImageFormat = (typeof IMAGE_OPTIONS.outputFormat)[number];
export interface SharedImageOptions {
  size: string;
  quality: string;
  outputFormat?: ImageFormat;
}
export function validImageOptions(value: unknown): value is SharedImageOptions {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => ['size', 'quality', 'outputFormat'].includes(key)) &&
    validImageSize(value.size) &&
    validImageQuality(value.quality) &&
    (value.outputFormat === undefined || validImageFormat(value.outputFormat))
  );
}
export interface SharedPreset {
  id: string;
  name: string;
  model: string;
  effort: string;
  fast: boolean;
  connectionKey?: string;
  capability?: ActionCapability;
  imageOptions?: SharedImageOptions;
  speechOptions?: SharedSpeechOptions;
}
const connectionDefinition = z
  .strictObject({
    key: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    kind: z.enum(['chatgpt-plan', 'openai-api']),
    // These limits count UTF-16 units in both runtimes.
    name: z.string().refine((name) => !!name.trim() && name.length <= 80),
    // Missing account means setup has not yet bound one. Missing URL means the official API.
    accountId: z
      .string()
      .refine((id) => id.length > 0 && id.length <= 256)
      .optional(),
    baseUrl: z.string().refine(validConnectionEndpoint).optional(),
  })
  .refine(({ kind, accountId, baseUrl }) =>
    kind === 'chatgpt-plan' ? baseUrl === undefined : accountId === undefined,
  );
export type ConnectionDefinition = z.infer<typeof connectionDefinition>;
const connections = z
  .array(connectionDefinition)
  .refine(
    (items) =>
      new Set(items.map((p) => p.key)).size === items.length &&
      new Set(items.map((p) => p.name.trim().toLowerCase())).size === items.length,
  );
export const DEFAULT_CONNECTIONS: readonly ConnectionDefinition[] = [
  { key: 'gpt-plan', name: 'ChatGPT plan', kind: 'chatgpt-plan' },
  { key: 'openai-api', name: 'OpenAI API', kind: 'openai-api' },
];
export function connectionCapabilities(connection: ConnectionDefinition): ActionCapability[] {
  return connection.kind === 'chatgpt-plan' ||
    (connection.baseUrl && connection.baseUrl !== 'https://api.openai.com/v1')
    ? ['write']
    : ['write', 'draw', 'speak'];
}
export function validConnectionEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) &&
      value === url.href.replace(/\/+$/, '')
    );
  } catch {
    return false;
  }
}
export function validateConnectionChanges(
  previous: ConnectionDefinition[],
  next: ConnectionDefinition[],
) {
  for (const connection of previous) {
    const replacement = next.find((item) => item.key === connection.key);
    if (!replacement) continue;
    if (
      replacement.kind !== connection.kind ||
      (connection.accountId !== undefined && replacement.accountId !== connection.accountId) ||
      (connection.kind === 'openai-api' &&
        (replacement.baseUrl ?? 'https://api.openai.com/v1') !==
          (connection.baseUrl ?? 'https://api.openai.com/v1'))
    )
      throw new Error(
        'A connection cannot change its account or endpoint. Add another connection.',
      );
  }
}
export function validateConnections(value: unknown): asserts value is ConnectionDefinition[] {
  if (!Array.isArray(value) || value.length > 32 || !connections.safeParse(value).success)
    throw new Error('Connections need unique keys and names and a supported kind.');
}
export interface SharedPresets {
  revision: number;
  presets: SharedPreset[];
  connections: ConnectionDefinition[];
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
            'connectionKey',
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
        (p.connectionKey === undefined ||
          (typeof p.connectionKey === 'string' &&
            /^[a-z][a-z0-9-]{0,63}$/.test(p.connectionKey))) &&
        (p.capability === undefined || validActionCapability(p.capability)) &&
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
