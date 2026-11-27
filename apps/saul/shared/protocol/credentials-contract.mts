import {
  validConnectionGeneration,
  validConnectionKey,
  validConnectionReservation,
  validConnectionToken,
  type ConnectionReservation,
} from './connection-coordination.mts';
import { validVisionImages } from './vision.mts';
import { isRecord } from '../model/value.mts';
import {
  validConnectionCatalog,
  validConnectionStatus,
  type ConnectionCatalog,
  type ConnectionStatus,
} from './connections-contract.mts';
import {
  validConnectionEndpoint,
  validImageSize,
  validImageQuality,
  validImageFormat,
  validSpeechVoice,
} from './shared-presets-contract.mts';
import {
  validatePlanRequest,
  validPlanAccount,
  validPlanAccounts,
  validPlanModels,
  validSuggestedAppName,
  type PlanRequest,
  type PlanResults,
} from './credential-plan.mts';

export const CREDENTIALS_VERSION = 2;
export const CREDENTIALS_HOST = 'com.saul.credentials';
export const CREDENTIALS_PORT = 'saul-credentials';
export function officialOpenAI(baseUrl: string): boolean {
  return ['https://api.openai.com/v1', 'https://api.openai.com/v1/chat/completions'].includes(
    baseUrl.replace(/\/+$/, ''),
  );
}
export type ConnectionCatalogIntent = 'display' | 'refresh' | 'check';
export type CredentialRequest =
  | Exclude<PlanRequest, { action: 'login' | 'logout' | 'generate' }>
  | (Extract<PlanRequest, { action: 'login' | 'logout' }> & { setupToken?: string })
  | (Extract<PlanRequest, { action: 'generate' }> & { runGeneration?: string })
  | { action: 'connection-capabilities' | 'connection-setups' }
  | { action: 'connection-run-hold'; connectionKey?: string; accountId?: string }
  | {
      action: 'connection-setup-hold';
      connectionKey: string;
      accountId?: string;
      operationId: string;
      previousToken?: string;
    }
  | { action: 'connection-setup-release'; connectionKey: string; token: string }
  | { action: 'confirm-app-name'; accountId: string; suggestedAppName: string; setupToken?: string }
  | { action: 'connection-status'; connectionKey: string }
  | ({
      action: 'connection-catalog';
      connectionKey: string;
    } & ({ intent: ConnectionCatalogIntent; force?: never } | { intent?: never; force?: boolean }))
  | {
      action: 'connection-key-save';
      connectionKey: string;
      endpoint: string;
      key: string;
      setupToken?: string;
    }
  | {
      action: 'connection-key-remove';
      connectionKey: string;
      endpoint: string;
      setupToken?: string;
    }
  | { action: 'connection-key-status'; connectionKey: string; endpoint: string }
  | { action: 'status' | 'api-key-status' | 'api-key-remove' }
  | { action: 'select'; accountId: string }
  | { action: 'api-key-save'; key: string }
  | {
      action: 'api-chat';
      runGeneration?: string;
      connectionKey?: string;
      model: string;
      systemPrompt: string;
      userPrompt: string;
      images?: string[];
      temperature?: number;
      maxTokens?: number;
    }
  | {
      action: 'api-realtime';
      model: string;
      voice: string;
      connectionKey?: string;
      runGeneration?: string;
    }
  | {
      action: 'api-image';
      runGeneration?: string;
      connectionKey?: string;
      prompt: string;
      model: string;
      size: string;
      quality: string;
      outputFormat: 'png' | 'gif';
    };
type CredentialSummary = PlanResults['accounts'] & {
  apiConnected?: boolean;
  selectedAccountId?: string;
};
type CredentialResults = PlanResults & {
  status: Partial<CredentialSummary>;
  select: CredentialSummary;
  'api-key-status': { apiConnected: boolean };
  'api-key-save': { apiConnected: boolean };
  'api-key-remove': { apiConnected: boolean };
  'connection-capabilities': { connectionCoordination: 1 };
  'connection-setups': { connectionSetups: ConnectionReservation[] };
  'connection-setup-release': Record<never, never>;
  'confirm-app-name': Record<never, never>;
  'connection-status': { connection: ConnectionStatus };
  'connection-catalog': { catalog: ConnectionCatalog };
  'connection-key-save': { connection: ConnectionStatus };
  'connection-key-remove': { connection: ConnectionStatus };
  'connection-key-status': { connection: ConnectionStatus };
  'api-realtime': { clientSecret: string };
  'api-image': { imageBase64: string };
};
type CredentialResultEvent = { type: 'result'; [key: string]: unknown };
export type CredentialResultRequest = CredentialRequest & { action: keyof CredentialResults };
export type CredentialResult<T extends CredentialResultRequest> = CredentialResultEvent &
  CredentialResults[T['action']];
export type NativeCredentialEnvelope = { version: typeof CREDENTIALS_VERSION; id: string } & (
  { request: CredentialRequest } | { cancel: true }
);

export type CredentialEvent =
  | { type: 'connection-held'; token: string; generation?: never }
  | { type: 'connection-held'; generation: string; token?: never }
  | { type: 'delta'; text: string }
  | { type: 'activity'; phase: 'waiting' | 'thinking' }
  | { type: 'complete' }
  | CredentialResultEvent
  | { type: 'authorize'; url: string }
  | { type: 'error'; message: string; reason?: string };

const resultFields = {
  accounts: 'accounts',
  login: 'account',
  logout: 'account',
  models: 'models',
  status: undefined, // Older helpers only guaranteed a successful status acknowledgement.
  select: 'accounts',
  'api-key-status': 'apiConnected',
  'api-key-save': 'apiConnected',
  'api-key-remove': 'apiConnected',
  'connection-capabilities': 'connectionCoordination',
  'connection-setups': 'connectionSetups',
  'connection-setup-release': undefined,
  'confirm-app-name': undefined,
  'connection-status': 'connection',
  'connection-catalog': 'catalog',
  'connection-key-save': 'connection',
  'connection-key-remove': 'connection',
  'connection-key-status': 'connection',
  'api-realtime': 'clientSecret',
  'api-image': 'imageBase64',
} satisfies { [K in keyof CredentialResults]: keyof CredentialResults[K] | undefined };

/** The event decoder checks field shapes. Check the result belongs to this operation. */
export function validateCredentialResult<T extends CredentialResultRequest>(
  request: T,
  event: CredentialResultEvent,
): asserts event is CredentialResult<T> {
  const field = resultFields[request.action];
  if (field !== undefined && event[field] === undefined)
    throw new Error('Saul returned an invalid credential result for this operation.');
}

const text = (value: unknown, max: number, empty = false): value is string =>
  typeof value === 'string' && (empty || value.length > 0) && value.length <= max;
export function validateCredentialRequest(value: unknown): asserts value is CredentialRequest {
  if (!isRecord(value) || typeof value.action !== 'string')
    throw new Error('Invalid Saul credential operation.');
  const setupTokenActions = [
    'login',
    'logout',
    'confirm-app-name',
    'connection-key-save',
    'connection-key-remove',
  ];
  const generationActions = ['generate', 'api-chat', 'api-realtime', 'api-image'];
  if (
    (Object.hasOwn(value, 'setupToken') &&
      (!setupTokenActions.includes(value.action) || !validConnectionToken(value.setupToken))) ||
    (Object.hasOwn(value, 'runGeneration') &&
      (!generationActions.includes(value.action) ||
        !validConnectionGeneration(value.runGeneration)))
  )
    throw new Error('Invalid connection coordination request.');
  if (['accounts', 'login', 'logout', 'models', 'generate'].includes(value.action)) {
    const { setupToken, runGeneration, ...plan } = value;
    void setupToken;
    void runGeneration;
    validatePlanRequest(plan);
    return;
  }
  const operations: Record<string, string[]> = {
    status: [],
    'connection-capabilities': [],
    'connection-setups': [],
    'connection-run-hold': ['connectionKey', 'accountId'],
    'connection-setup-hold': ['connectionKey', 'accountId', 'operationId', 'previousToken'],
    'connection-setup-release': ['connectionKey', 'token'],
    select: ['accountId'],
    'confirm-app-name': ['accountId', 'suggestedAppName', 'setupToken'],
    'api-key-status': [],
    'api-key-remove': [],
    'api-key-save': ['key'],
    'connection-status': ['connectionKey'],
    'connection-catalog': ['connectionKey', 'force', 'intent'],
    'connection-key-save': ['connectionKey', 'endpoint', 'key', 'setupToken'],
    'connection-key-remove': ['connectionKey', 'endpoint', 'setupToken'],
    'connection-key-status': ['connectionKey', 'endpoint'],
    'api-chat': [
      'model',
      'systemPrompt',
      'userPrompt',
      'images',
      'temperature',
      'maxTokens',
      'connectionKey',
      'runGeneration',
    ],
    'api-realtime': ['model', 'voice', 'connectionKey', 'runGeneration'],
    'api-image': [
      'prompt',
      'model',
      'size',
      'quality',
      'outputFormat',
      'connectionKey',
      'runGeneration',
    ],
  };
  const fields = operations[value.action];
  if (!fields || Object.keys(value).some((key) => key !== 'action' && !fields.includes(key)))
    throw new Error('Unsupported Saul credential operation.');
  if (
    value.action === 'confirm-app-name' &&
    (!text(value.accountId, 256) || !validSuggestedAppName(value.suggestedAppName))
  )
    throw new Error('Invalid ChatGPT app name confirmation.');
  if (
    ((value.action.startsWith('connection-') &&
      !['connection-capabilities', 'connection-setups', 'connection-run-hold'].includes(
        value.action,
      )) ||
      value.connectionKey !== undefined) &&
    !validConnectionKey(value.connectionKey)
  )
    throw new Error('Choose a saved connection.');
  if (
    ((value.action === 'connection-run-hold' || value.action === 'connection-setup-hold') &&
      value.accountId !== undefined &&
      !text(value.accountId, 256)) ||
    (value.action === 'connection-run-hold' &&
      value.connectionKey === undefined &&
      value.accountId === undefined) ||
    (value.action === 'connection-setup-hold' &&
      (!validConnectionToken(value.operationId) ||
        (value.previousToken !== undefined && !validConnectionToken(value.previousToken)))) ||
    (value.action === 'connection-setup-release' && !validConnectionToken(value.token))
  )
    throw new Error('Invalid connection coordination request.');
  if (value.force !== undefined && typeof value.force !== 'boolean')
    throw new Error('Invalid refresh request.');
  if (
    value.intent !== undefined &&
    (value.force !== undefined ||
      (value.intent !== 'display' && value.intent !== 'refresh' && value.intent !== 'check'))
  )
    throw new Error('Invalid catalog intent.');
  if (value.action === 'connection-key-status' && !validConnectionEndpoint(value.endpoint))
    throw new Error('Enter a valid endpoint.');
  if (value.action === 'connection-key-save' || value.action === 'connection-key-remove') {
    if (
      !validConnectionEndpoint(value.endpoint) ||
      (value.action === 'connection-key-save' &&
        (!text(value.key, 512, true) || !/^[!-~]*$/.test(value.key)))
    )
      throw new Error('Enter a valid endpoint and key without spaces.');
  }
  if (
    value.action === 'api-image' &&
    (!text(value.prompt, 32_000) ||
      !text(value.model, 256) ||
      !validImageSize(value.size) ||
      !validImageQuality(value.quality) ||
      !validImageFormat(value.outputFormat) ||
      (value.outputFormat === 'gif' && !value.model.startsWith('gpt-image-2.6-')))
  )
    throw new Error('Choose a supported Draw model and image options. GIF requires GPT Image 2.6.');
  if (value.action === 'select' && !text(value.accountId, 256))
    throw new Error('Choose a Saul account.');
  if (value.action === 'api-key-save') {
    if (!text(value.key, 512) || !/^[!-~]+$/.test(value.key))
      throw new Error('Enter a valid OpenAI API key without spaces.');
  }
  if (
    value.action === 'api-chat' &&
    (!text(value.model, 256) ||
      !text(value.systemPrompt, 100_000, true) ||
      !text(value.userPrompt, 200_000) ||
      (value.images !== undefined && !validVisionImages(value.images)) ||
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
      !validSpeechVoice(value.voice))
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
            'clientSecret',
            'imageBase64',
            'connection',
            'catalog',
            'connectionCoordination',
            'connectionSetups',
          ].includes(key),
      )
    )
      throw new Error('Saul returned an unexpected credential result.');
    if (
      value.imageBase64 !== undefined &&
      (!text(value.imageBase64, 28_000_000) || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.imageBase64))
    )
      throw new Error('Invalid image result.');
    if (
      (value.connectionCoordination !== undefined && value.connectionCoordination !== 1) ||
      (value.connectionSetups !== undefined &&
        (!Array.isArray(value.connectionSetups) ||
          !value.connectionSetups.every(validConnectionReservation))) ||
      (value.connection !== undefined && !validConnectionStatus(value.connection)) ||
      (value.catalog !== undefined && !validConnectionCatalog(value.catalog)) ||
      (value.accounts !== undefined && !validPlanAccounts(value.accounts)) ||
      (value.account !== undefined && !validPlanAccount(value.account)) ||
      (value.models !== undefined && !validPlanModels(value.models)) ||
      (value.selectedAccountId !== undefined && !text(value.selectedAccountId, 256)) ||
      (value.apiConnected !== undefined && typeof value.apiConnected !== 'boolean') ||
      (value.warning !== undefined && !text(value.warning, 4000)) ||
      (value.clientSecret !== undefined &&
        (!text(value.clientSecret, 4096) || !/^[A-Za-z0-9_-]+$/.test(value.clientSecret)))
    )
      throw new Error('Saul returned an invalid credential summary.');
    return;
  }
  const fields: Record<string, string[]> = {
    complete: [],
    'connection-held': ['token', 'generation'],
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
    (value.type === 'connection-held' &&
      ((validConnectionToken(value.token) && value.generation === undefined) ||
        (validConnectionGeneration(value.generation) && value.token === undefined))) ||
    (value.type === 'activity' && (value.phase === 'waiting' || value.phase === 'thinking')) ||
    (value.type === 'delta' && text(value.text, 2_000_000, true)) ||
    (value.type === 'authorize' && text(value.url, 32_000)) ||
    (value.type === 'error' &&
      text(value.message, 4000) &&
      (value.reason === undefined || text(value.reason, 128)))
  )
    return;
  throw new Error('Saul returned an invalid credential event.');
}
