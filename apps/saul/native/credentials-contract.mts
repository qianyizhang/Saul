import { isRecord } from './value.mts';
import { validatePlanRequest, type PlanRequest } from './plan-protocol.mts';

export const CREDENTIALS_HOST = 'com.saul.credentials';
export const CREDENTIALS_PORT = 'saul-credentials';
export function officialOpenAI(baseUrl: string): boolean {
  return ['https://api.openai.com/v1', 'https://api.openai.com/v1/chat/completions'].includes(
    baseUrl.replace(/\/+$/, ''),
  );
}
export type CredentialPlanRequest = Extract<
  PlanRequest,
  { action: 'accounts' | 'login' | 'logout' | 'models' | 'generate' }
>;
export type CredentialRequest =
  | CredentialPlanRequest
  | { action: 'status' | 'api-key-status' | 'api-key-remove' | 'migration-verified' }
  | { action: 'select'; accountId: string }
  | { action: 'api-key-save'; key: string }
  | { action: 'api-key-import'; key: string; selectedAccountId?: string }
  | {
      action: 'api-chat';
      model: string;
      systemPrompt: string;
      userPrompt: string;
      temperature?: number;
      maxTokens?: number;
    }
  | { action: 'api-realtime'; model: string; voice: string }
  | {
      action: 'api-image';
      prompt: string;
      model: string;
      size: string;
      quality: string;
      outputFormat: 'png' | 'gif';
    };
export type CredentialEvent =
  | { type: 'delta'; text: string }
  | { type: 'activity'; phase: 'waiting' | 'thinking' }
  | { type: 'complete' }
  | { type: 'result'; [key: string]: unknown }
  | { type: 'authorize'; url: string }
  | { type: 'error'; message: string; reason?: string };

export function isCredentialPlan(request: PlanRequest): request is CredentialPlanRequest {
  return ['accounts', 'login', 'logout', 'models', 'generate'].includes(request.action);
}
const text = (value: unknown, max: number, empty = false): value is string =>
  typeof value === 'string' && (empty || value.length > 0) && value.length <= max;
export function validateCredentialRequest(value: unknown): asserts value is CredentialRequest {
  if (!isRecord(value) || typeof value.action !== 'string')
    throw new Error('Invalid Saul credential operation.');
  if (['accounts', 'login', 'logout', 'models', 'generate'].includes(value.action)) {
    validatePlanRequest(value);
    return;
  }
  const operations: Record<string, string[]> = {
    status: [],
    select: ['accountId'],
    'api-key-status': [],
    'api-key-remove': [],
    'api-key-save': ['key'],
    'api-key-import': ['key', 'selectedAccountId'],
    'api-chat': ['model', 'systemPrompt', 'userPrompt', 'temperature', 'maxTokens'],
    'api-realtime': ['model', 'voice'],
    'api-image': ['prompt', 'model', 'size', 'quality', 'outputFormat'],
    'migration-verified': [],
  };
  const fields = operations[value.action];
  if (!fields || Object.keys(value).some((key) => key !== 'action' && !fields.includes(key)))
    throw new Error('Unsupported Saul credential operation.');
  if (
    value.action === 'api-image' &&
    (!text(value.prompt, 32_000) ||
      ![
        'gpt-image-2.6-flare',
        'gpt-image-2.6-sunburst',
        'gpt-image-2.5-flare',
        'gpt-image-2.5-sunburst',
      ].includes(String(value.model)) ||
      !['1024x1024', '1536x1024', '1024x1536'].includes(String(value.size)) ||
      !['low', 'medium', 'high'].includes(String(value.quality)) ||
      !['png', 'gif'].includes(String(value.outputFormat)) ||
      (value.outputFormat === 'gif' && !String(value.model).startsWith('gpt-image-2.6-')))
  )
    throw new Error('Choose a supported Draw model and image options. GIF requires GPT Image 2.6.');
  if (value.action === 'select' && !text(value.accountId, 256))
    throw new Error('Choose a Saul account.');
  if (value.action === 'api-key-save' || value.action === 'api-key-import') {
    if (
      !text(value.key, 512) ||
      !/^[!-~]+$/.test(value.key) ||
      (value.selectedAccountId !== undefined && !text(value.selectedAccountId, 256))
    )
      throw new Error('Enter a valid OpenAI API key without spaces.');
  }
  if (
    value.action === 'api-chat' &&
    (!text(value.model, 256) ||
      !text(value.systemPrompt, 100_000, true) ||
      !text(value.userPrompt, 200_000) ||
      (value.temperature !== undefined &&
        (typeof value.temperature !== 'number' ||
          !Number.isFinite(value.temperature) ||
          value.temperature < 0 ||
          value.temperature > 2)) ||
      (value.maxTokens !== undefined &&
        (!Number.isSafeInteger(value.maxTokens) ||
          Number(value.maxTokens) < 1 ||
          Number(value.maxTokens) > 1_000_000)))
  )
    throw new Error('Invalid OpenAI API request.');
  if (
    value.action === 'api-realtime' &&
    (!text(value.model, 256) ||
      !/^gpt-realtime(?:-[a-z0-9.]+)*$/.test(value.model) ||
      ![
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
      ].includes(String(value.voice)))
  )
    throw new Error('Choose a supported Realtime model and voice.');
}

export function validateCredentialEvent(value: unknown): asserts value is CredentialEvent {
  if (!isRecord(value) || typeof value.type !== 'string')
    throw new Error('Saul returned an invalid credential reply.');
  if (value.type === 'result') {
    // These are the only result fields the browser may receive; token record fields are never permitted.
    if (
      Object.keys(value).some(
        (key) =>
          ![
            'type',
            'accounts',
            'account',
            'selectedAccountId',
            'apiConnected',
            'models',
            'warning',
            'retired',
            'clientSecret',
            'imageBase64',
          ].includes(key),
      )
    )
      throw new Error('Saul returned an unexpected credential result.');
    const account = (a: unknown): boolean =>
      isRecord(a) &&
      Object.keys(a).every((k) => ['id', 'label', 'signedIn', 'planEnabled'].includes(k)) &&
      text(a.id, 256) &&
      text(a.label, 2000) &&
      typeof a.signedIn === 'boolean' &&
      typeof a.planEnabled === 'boolean';
    const model = (m: unknown): boolean =>
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
      (m.fastTier === undefined || ['fast', 'priority'].includes(String(m.fastTier))) &&
      Array.isArray(m.supportedReasoningEfforts) &&
      m.supportedReasoningEfforts.length <= 100 &&
      m.supportedReasoningEfforts.every(
        (e) =>
          isRecord(e) &&
          Object.keys(e).every((k) => ['effort', 'description'].includes(k)) &&
          text(e.effort, 64) &&
          text(e.description, 4000, true),
      );
    if (
      value.imageBase64 !== undefined &&
      (!text(value.imageBase64, 28_000_000) || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.imageBase64))
    )
      throw new Error('Invalid image result.');
    if (
      (value.accounts !== undefined &&
        (!Array.isArray(value.accounts) ||
          value.accounts.length > 1000 ||
          !value.accounts.every(account))) ||
      (value.account !== undefined && !account(value.account)) ||
      (value.models !== undefined &&
        (!Array.isArray(value.models) ||
          value.models.length > 10000 ||
          !value.models.every(model))) ||
      (value.selectedAccountId !== undefined && !text(value.selectedAccountId, 256)) ||
      (value.apiConnected !== undefined && typeof value.apiConnected !== 'boolean') ||
      (value.retired !== undefined && typeof value.retired !== 'boolean') ||
      (value.warning !== undefined && !text(value.warning, 4000)) ||
      (value.clientSecret !== undefined &&
        (!text(value.clientSecret, 4096) || !/^[A-Za-z0-9_-]+$/.test(value.clientSecret)))
    )
      throw new Error('Saul returned an invalid credential summary.');
    return;
  }
  const fields: Record<string, string[]> = {
    complete: [],
    activity: ['phase'],
    delta: ['text'],
    authorize: ['url'],
    error: ['message', 'reason'],
  };
  const eventType = value.type;
  if (
    !fields[value.type] ||
    Object.keys(value).some((k) => k !== 'type' && !fields[eventType]!.includes(k))
  )
    throw new Error('Saul returned unexpected credential event fields.');
  if (
    value.type === 'complete' ||
    (value.type === 'activity' && ['waiting', 'thinking'].includes(String(value.phase))) ||
    (value.type === 'delta' && text(value.text, 2_000_000, true)) ||
    (value.type === 'authorize' && text(value.url, 32_000)) ||
    (value.type === 'error' &&
      text(value.message, 4000) &&
      (value.reason === undefined || text(value.reason, 128)))
  )
    return;
  throw new Error('Saul returned an invalid credential event.');
}
