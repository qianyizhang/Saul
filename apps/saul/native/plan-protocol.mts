import { isRecord } from './value.mts';
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
export type PlanRequest =
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
    };
export type PlanControlRequest = Exclude<PlanRequest, { action: 'generate' }>;
export interface PlanResults {
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
    accounts: [],
    login: ['accountId', 'consent'],
    logout: ['accountId'],
    models: ['accountId'],
    speech: ['accountId', 'input', 'voice'],
    generate: ['accountId', 'model', 'effort', 'fast', 'systemPrompt', 'userPrompt'],
  };
  const keys = typeof v.action === 'string' ? operations[v.action] : undefined;
  if (!Array.isArray(keys) || Object.keys(v).some((k) => k !== 'action' && !keys.includes(k)))
    throw new Error('Unsupported plan operation');
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
