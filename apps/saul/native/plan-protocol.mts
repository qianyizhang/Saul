import { isRecord } from './value.mts';
import {
  validateSharedPresets,
  type SharedPreset,
  type SharedPresets,
} from './shared-presets-contract.mts';
export interface PlanAccount {
  id: string;
  label: string;
  signedIn: boolean;
  planEnabled: boolean;
}
export interface PlanModel {
  slug: string;
  display_name: string;
  supportedReasoningEfforts: { effort: string; description: string }[];
  defaultReasoningEffort: string;
  fastTier?: string;
  isDefault: boolean;
}
export interface PdfUrlAttachment {
  type: 'pdf-url';
  url: string;
}
export function validPdfUrlAttachment(value: unknown): value is PdfUrlAttachment {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !['type', 'url'].includes(key)) ||
    value.type !== 'pdf-url' ||
    typeof value.url !== 'string' ||
    value.url.length > 16_384
  )
    return false;
  try {
    const url = new URL(value.url);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}
export type PlanRequest =
  | { action: 'presets-read' }
  | { action: 'presets-import'; presets: SharedPreset[] }
  | { action: 'presets-save'; revision: number; presets: SharedPreset[] }
  | { action: 'accounts' }
  | { action: 'login'; accountId?: string; consent?: boolean }
  | { action: 'logout'; accountId: string }
  | { action: 'models'; accountId: string }
  | { action: 'speech'; accountId: string; input: string; voice: string }
  | {
      action: 'generate';
      accountId: string;
      model: string;
      effort?: string;
      fast?: boolean;
      systemPrompt: string;
      userPrompt: string;
      attachments?: PdfUrlAttachment[];
    };
export type PlanControlRequest = Exclude<PlanRequest, { action: 'generate' }>;
export interface PlanResults {
  'presets-read': { library: SharedPresets };
  'presets-import': { library: SharedPresets };
  'presets-save': { library: SharedPresets };
  accounts: { accounts: PlanAccount[] };
  login: { account: PlanAccount };
  logout: { account: PlanAccount; warning?: string };
  models: { models: PlanModel[] };
  speech: { audioBase64: string; mimeType: 'audio/mpeg' };
}
export type PlanResult<T extends PlanControlRequest = PlanControlRequest> = {
  type: 'result';
} & PlanResults[T['action']];
export type PlanEvent =
  | { type: 'activity'; phase: 'waiting' | 'thinking' }
  | { type: 'delta'; text: string }
  | { type: 'complete' }
  | PlanResult
  | { type: 'authorize'; url: string }
  | { type: 'error'; message: string; reason?: string };

// Shared extension/native contract. Credentials never cross this boundary.
export const PLAN_HOST = 'com.saul.chatgpt';
export const PLAN_PORT = 'saul-chatgpt';
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;
export function validatePlanRequest(v: unknown): asserts v is PlanRequest {
  if (!isRecord(v)) throw new Error('Invalid plan request');
  const operations: Record<string, string[]> = {
    'presets-read': [],
    'presets-import': ['presets'],
    'presets-save': ['revision', 'presets'],
    accounts: [],
    login: ['accountId', 'consent'],
    logout: ['accountId'],
    models: ['accountId'],
    speech: ['accountId', 'input', 'voice'],
    generate: ['accountId', 'model', 'effort', 'fast', 'systemPrompt', 'userPrompt', 'attachments'],
  };
  const keys = typeof v.action === 'string' ? operations[v.action] : undefined;
  if (!Array.isArray(keys) || Object.keys(v).some((k) => k !== 'action' && !keys.includes(k)))
    throw new Error('Unsupported plan operation');
  if (v.action === 'presets-read') return;
  if (v.action === 'presets-import' || v.action === 'presets-save') {
    validateSharedPresets(v.presets);
    if (
      v.action === 'presets-save' &&
      (!Number.isSafeInteger(v.revision) || Number(v.revision) < 0)
    )
      throw new Error('Invalid shared preset revision.');
    return;
  }
  if (v.action !== 'accounts' && v.action !== 'login' && !text(v.accountId, 256))
    throw new Error('Choose a ChatGPT account');
  if (
    v.action === 'login' &&
    ((v.accountId !== undefined && !text(v.accountId, 256)) ||
      (v.consent !== undefined && typeof v.consent !== 'boolean'))
  )
    throw new Error('Invalid sign-in request');
  if (
    v.action === 'speech' &&
    (!text(v.input, 512) ||
      !v.input.trim() ||
      typeof v.voice !== 'string' ||
      !['coral', 'alloy', 'marin', 'cedar'].includes(v.voice))
  )
    throw new Error('Speech requires 1–512 characters and a supported voice.');
  if (
    v.action === 'generate' &&
    (!text(v.model, 256) ||
      typeof v.systemPrompt !== 'string' ||
      v.systemPrompt.length > 100000 ||
      !text(v.userPrompt, 200000) ||
      (v.attachments !== undefined &&
        (!Array.isArray(v.attachments) ||
          v.attachments.length !== 1 ||
          !v.attachments.every(validPdfUrlAttachment))) ||
      (v.effort !== undefined && (typeof v.effort !== 'string' || v.effort.length > 64)) ||
      (v.fast !== undefined && typeof v.fast !== 'boolean'))
  )
    throw new Error('Invalid generation request');
}

const record = isRecord;
const account = (v: unknown) =>
  record(v) &&
  text(v.id, 256) &&
  text(v.label, 1000) &&
  typeof v.signedIn === 'boolean' &&
  typeof v.planEnabled === 'boolean';
const model = (v: unknown) =>
  record(v) &&
  text(v.slug, 256) &&
  text(v.display_name, 1000) &&
  Array.isArray(v.supportedReasoningEfforts) &&
  v.supportedReasoningEfforts.every(
    (level) => record(level) && text(level.effort, 64) && typeof level.description === 'string',
  ) &&
  typeof v.defaultReasoningEffort === 'string' &&
  v.defaultReasoningEffort.length <= 64 &&
  (v.fastTier === undefined || text(v.fastTier, 256)) &&
  typeof v.isDefault === 'boolean';
export function validatePlanResult<T extends PlanControlRequest>(
  request: T,
  value: unknown,
): asserts value is PlanResult<T> {
  const validators: Record<PlanControlRequest['action'], (v: Record<string, unknown>) => boolean> =
    {
      'presets-read': sharedLibrary,
      'presets-import': sharedLibrary,
      'presets-save': sharedLibrary,
      accounts: (v) => Array.isArray(v.accounts) && v.accounts.every(account),
      login: (v) => account(v.account),
      logout: (v) =>
        account(v.account) && (v.warning === undefined || typeof v.warning === 'string'),
      speech: (v) =>
        v.mimeType === 'audio/mpeg' &&
        text(v.audioBase64, 800000) &&
        v.audioBase64.length % 4 === 0 &&
        /^[A-Za-z0-9+/]+={0,2}$/.test(v.audioBase64),
      models: (v) => Array.isArray(v.models) && v.models.every(model),
    };
  if (
    !record(value) ||
    value.type !== 'result' ||
    !Object.hasOwn(validators, request.action) ||
    !validators[request.action](value)
  )
    throw new Error('ChatGPT helper returned an invalid reply. Update the helper and retry.');
}

function sharedLibrary(value: Record<string, unknown>): boolean {
  if (
    !record(value.library) ||
    !Number.isSafeInteger(value.library.revision) ||
    Number(value.library.revision) < 0
  )
    return false;
  try {
    validateSharedPresets(value.library.presets);
    return true;
  } catch {
    return false;
  }
}
