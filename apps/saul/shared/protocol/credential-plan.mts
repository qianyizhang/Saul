import { validVisionImages } from './vision.mts';
import { isRecord } from '../model/value.mts';
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
  | { action: 'accounts' }
  | { action: 'login'; accountId?: string; consent?: boolean }
  | { action: 'logout'; accountId: string }
  | { action: 'models'; accountId: string }
  | {
      action: 'generate';
      accountId: string;
      connectionKey?: string;
      model: string;
      effort?: string;
      fast?: boolean;
      systemPrompt: string;
      userPrompt: string;
      attachments?: PdfUrlAttachment[];
      images?: string[];
    };
export type PlanControlRequest = Exclude<PlanRequest, { action: 'generate' }>;
export interface PlanResults {
  accounts: { accounts: PlanAccount[] };
  login: { account: PlanAccount };
  logout: { account: PlanAccount; warning?: string };
  models: { models: PlanModel[] };
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

const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;
export function validatePlanRequest(v: unknown): asserts v is PlanRequest {
  if (!isRecord(v)) throw new Error('Invalid plan request');
  const operations: Record<string, string[]> = {
    accounts: [],
    login: ['accountId', 'consent'],
    logout: ['accountId'],
    models: ['accountId'],
    generate: [
      'accountId',
      'connectionKey',
      'model',
      'effort',
      'fast',
      'systemPrompt',
      'userPrompt',
      'attachments',
      'images',
    ],
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
    v.action === 'generate' &&
    (!text(v.model, 256) ||
      (v.connectionKey !== undefined &&
        (!text(v.connectionKey, 64) || !/^[a-z][a-z0-9-]{0,63}$/.test(v.connectionKey))) ||
      typeof v.systemPrompt !== 'string' ||
      v.systemPrompt.length > 100000 ||
      !text(v.userPrompt, 200000) ||
      (v.images !== undefined && !validVisionImages(v.images)) ||
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
      accounts: (v) => Array.isArray(v.accounts) && v.accounts.every(account),
      login: (v) => account(v.account),
      logout: (v) =>
        account(v.account) && (v.warning === undefined || typeof v.warning === 'string'),
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
