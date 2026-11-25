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
  | { action: 'login'; accountId?: string; consent?: boolean; suggestedAppName?: string }
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

const text = (v: unknown, max: number, empty = false): v is string =>
  typeof v === 'string' && (empty || v.length > 0) && v.length <= max;
export const validSuggestedAppName = (name: unknown): name is string =>
  typeof name === 'string' && name.length === 17 && /^Saul [0-9A-F]{12}$/.test(name);
export function validatePlanRequest(v: unknown): asserts v is PlanRequest {
  if (!isRecord(v)) throw new Error('Invalid plan request');
  const operations: Record<string, string[]> = {
    accounts: [],
    login: ['accountId', 'consent', 'suggestedAppName'],
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
      (v.consent !== undefined && typeof v.consent !== 'boolean') ||
      (v.suggestedAppName !== undefined &&
        (v.accountId !== undefined || !validSuggestedAppName(v.suggestedAppName))))
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

export const validPlanAccount = (a: unknown): a is PlanAccount =>
  isRecord(a) &&
  Object.keys(a).every((k) => ['id', 'label', 'signedIn', 'planEnabled'].includes(k)) &&
  text(a.id, 256) &&
  text(a.label, 2000) &&
  typeof a.signedIn === 'boolean' &&
  typeof a.planEnabled === 'boolean';
export const validPlanModel = (m: unknown): m is PlanModel =>
  isRecord(m) &&
  Object.keys(m).every((k) =>
    [
      'slug',
      'display_name',
      'defaultReasoningEffort',
      'isDefault',
      'supportedReasoningEfforts',
      'fastTier',
    ].includes(k),
  ) &&
  text(m.slug, 256) &&
  text(m.display_name, 1000) &&
  text(m.defaultReasoningEffort, 64, true) &&
  typeof m.isDefault === 'boolean' &&
  (m.fastTier === undefined || m.fastTier === 'fast' || m.fastTier === 'priority') &&
  Array.isArray(m.supportedReasoningEfforts) &&
  m.supportedReasoningEfforts.length <= 100 &&
  m.supportedReasoningEfforts.every(
    (e) =>
      isRecord(e) &&
      Object.keys(e).every((k) => ['effort', 'description'].includes(k)) &&
      text(e.effort, 64) &&
      text(e.description, 4000, true),
  );

export const validPlanAccounts = (value: unknown): value is PlanAccount[] =>
  Array.isArray(value) && value.length <= 1000 && value.every(validPlanAccount);
export const validPlanModels = (value: unknown): value is PlanModel[] =>
  Array.isArray(value) && value.length <= 10000 && value.every(validPlanModel);
export function validatePlanResult<T extends PlanControlRequest>(
  request: T,
  value: unknown,
): asserts value is PlanResult<T> {
  const fields = (...allowed: string[]) =>
    isRecord(value) && Object.keys(value).every((key) => key === 'type' || allowed.includes(key));
  const validators: Record<PlanControlRequest['action'], (v: Record<string, unknown>) => boolean> =
    {
      accounts: (v) =>
        fields('accounts', 'apiConnected', 'selectedAccountId') &&
        validPlanAccounts(v.accounts) &&
        (v.apiConnected === undefined || typeof v.apiConnected === 'boolean') &&
        (v.selectedAccountId === undefined || text(v.selectedAccountId, 256)),
      login: (v) => fields('account') && validPlanAccount(v.account),
      logout: (v) =>
        fields('account', 'warning') &&
        validPlanAccount(v.account) &&
        (v.warning === undefined || text(v.warning, 4000)),
      models: (v) => fields('models') && validPlanModels(v.models),
    };
  if (
    !isRecord(value) ||
    value.type !== 'result' ||
    !Object.hasOwn(validators, request.action) ||
    !validators[request.action](value)
  )
    throw new Error('ChatGPT helper returned an invalid reply. Update the helper and retry.');
}
