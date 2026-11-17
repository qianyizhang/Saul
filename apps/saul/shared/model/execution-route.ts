import { officialOpenAI } from '../protocol/credentials-contract.mts';
import {
  validActionCapability,
  validConnectionEndpoint,
  validImageOptions,
  validSpeechOptions,
  type ActionCapability,
  type SharedImageOptions,
} from '../protocol/shared-presets-contract.mts';
import { isRecord } from './value.mts';
import type { ModelPreset, ProviderType } from './presets.ts';
import { CHROME_AI_RETIRED_MESSAGE } from './retired-provider.ts';

export const SELECT_NEW_PRESET =
  'The saved connection has changed. Select a new preset in Settings, then start a new attempt.';

/** Persistable model choices; no page context, database fields or credential bytes. */
export interface FrozenModel {
  provider: ProviderType;
  credentialOwner?: 'local' | 'saul';
  remote: { baseUrl: string; model: string; temperature: number; credentialOwner?: 'saul' };
  local: { temperature: number; topK: number };
  plan?: { accountId: string; model: string; effort?: string; fast?: boolean };
  preset?: ModelPreset;
}
export interface ModelRequest extends FrozenModel {
  systemPrompt: string;
  userPrompt: string;
}

type ConnectionBinding = { kind: 'connection'; key: string };
type PlanChoices = NonNullable<FrozenModel['plan']>;
export type PlanExecution = {
  provider: 'chatgpt-plan';
  owner: 'saul';
  capability: 'write';
  binding: ConnectionBinding | { kind: 'legacy-account' };
  plan: PlanChoices;
};
export type APIExecution = {
  provider: 'openai-compatible';
  capability: ActionCapability;
  endpoint: string;
  model: string;
  temperature: number;
  imageOptions?: SharedImageOptions;
} & (
  | { owner: 'saul'; binding: ConnectionBinding | { kind: 'legacy-official' } }
  | { owner: 'local'; binding: { kind: 'profile'; id?: string } }
);
export type ExecutionModel = PlanExecution | APIExecution;

const invalid = (field: string) =>
  new Error(`Invalid saved ${field}. Choose a preset and run again.`);
function fields(value: unknown, keys: readonly string[], field: string) {
  if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key)))
    throw invalid(field);
  return value;
}
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && !!value.trim() && value.length <= max;
export function validateModelPrompts(value: unknown): void {
  if (
    !isRecord(value) ||
    typeof value.systemPrompt !== 'string' ||
    typeof value.userPrompt !== 'string' ||
    !value.userPrompt
  )
    throw invalid('instructions or prompt');
}

export function validateAPIPresetOptions(effort: unknown, fast: unknown): void {
  if (effort !== undefined && typeof effort !== 'string') throw invalid('reasoning effort');
  if (fast !== undefined && typeof fast !== 'boolean') throw invalid('Fast choice');
  if (effort || fast)
    throw new Error(
      "The preset requests reasoning or Fast options that Saul's API connection does not support. Run it in EZ or choose a supported preset.",
    );
}

export function validateEndpoint(baseUrl: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(baseUrl);
  } catch {
    throw new Error('Enter a valid model endpoint URL.');
  }
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error(
      'Use an HTTP(S) endpoint without credentials, query parameters, or a fragment.',
    );
  return endpoint;
}

function connectionKey(key: unknown): string {
  if (typeof key !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(key))
    throw invalid('connection key');
  return key;
}
function planChoices(value: Record<string, unknown>): PlanChoices {
  const { accountId, model, effort, fast } = value;
  if (!text(accountId, 256) || !text(model, 256))
    throw new Error('Choose a ChatGPT account and model in Settings.');
  if (effort !== undefined && (typeof effort !== 'string' || effort.length > 64))
    throw invalid('reasoning effort');
  if (fast !== undefined && typeof fast !== 'boolean') throw invalid('Fast choice');
  return {
    accountId,
    model,
    ...(effort !== undefined ? { effort } : {}),
    ...(fast !== undefined ? { fast } : {}),
  };
}

/** Decode the historical storage shape at execution. Inspectors still display its original fields. */
export function executionModel(value: unknown): ExecutionModel {
  const snapshot = fields(
    value,
    [
      'provider',
      'credentialOwner',
      'remote',
      'local',
      'plan',
      'preset',
      'systemPrompt',
      'userPrompt',
      'followUpQuestion',
      'context',
      'recipe',
    ],
    'model request',
  );
  const { provider, credentialOwner } = snapshot;
  if (provider === 'chrome-ai') throw new Error(CHROME_AI_RETIRED_MESSAGE);
  if (provider !== 'chatgpt-plan' && provider !== 'openai-compatible') throw invalid('provider');
  if (credentialOwner !== undefined && credentialOwner !== 'local' && credentialOwner !== 'saul')
    throw invalid('credential owner');
  const preset =
    snapshot.preset === undefined
      ? undefined
      : fields(
          snapshot.preset,
          [
            'id',
            'name',
            'provider',
            'model',
            'profileId',
            'temperature',
            'topK',
            'effort',
            'fast',
            'connectionKey',
            'capability',
            'imageOptions',
            'speechOptions',
            'shared',
          ],
          'preset',
        );
  if (preset && preset.provider !== provider) throw invalid('preset provider');
  if (preset && (!text(preset.id, 128) || !text(preset.name, 80))) throw invalid('preset identity');
  const capability = preset?.capability === undefined ? 'write' : preset.capability;
  if (!validActionCapability(capability)) throw invalid('preset capability');
  const key = preset?.connectionKey === undefined ? undefined : connectionKey(preset.connectionKey);
  const profile = preset?.profileId;
  if (profile !== undefined && !text(profile, 128)) throw invalid('API profile identity');
  const imageOptions = preset?.imageOptions;
  if (imageOptions !== undefined && !validImageOptions(imageOptions))
    throw invalid('image options');
  if (preset?.speechOptions !== undefined && !validSpeechOptions(preset.speechOptions))
    throw invalid('speech options');
  // Inactive provider settings have no say in routing, but cannot carry credential fields.
  const remote = fields(
    snapshot.remote,
    ['baseUrl', 'model', 'temperature', 'credentialOwner'],
    'API choices',
  );
  if (snapshot.local !== undefined)
    fields(snapshot.local, ['temperature', 'topK'], 'local choices');
  if (provider === 'chatgpt-plan') {
    if (credentialOwner !== 'saul' || !key) throw new Error(SELECT_NEW_PRESET);
    if (capability !== 'write') throw invalid('ChatGPT plan capability');
    const plan = planChoices(
      fields(snapshot.plan, ['accountId', 'model', 'effort', 'fast'], 'plan choices'),
    );
    if (plan.model !== preset?.model) throw invalid('preset model');
    if (preset.effort !== undefined && preset.effort !== (plan.effort ?? ''))
      throw invalid('preset reasoning effort');
    if (preset.fast !== undefined && preset.fast !== (plan.fast ?? false))
      throw invalid('preset Fast choice');
    return { provider, owner: 'saul', capability, binding: { kind: 'connection', key }, plan };
  }

  if (snapshot.plan !== undefined) throw invalid('API request with plan choices');
  const { baseUrl, model, temperature } = remote;
  if (typeof baseUrl !== 'string') throw invalid('model endpoint');
  validateEndpoint(baseUrl);
  if (!text(model, 256)) throw new Error('Enter a model name available from this provider.');
  if (preset && preset.model !== model) throw invalid('preset model');
  if (typeof temperature !== 'number' || !Number.isFinite(temperature))
    throw invalid('temperature');
  validateAPIPresetOptions(preset?.effort, preset?.fast);
  if (capability !== 'write' && baseUrl.replace(/\/+$/, '') !== 'https://api.openai.com/v1')
    throw new Error(
      `${capability === 'draw' ? 'Draw' : 'Speak'} requires the official OpenAI API connection.`,
    );
  const api = {
    provider,
    capability,
    endpoint: baseUrl,
    model,
    temperature,
    imageOptions,
  } as const;
  const nestedOwner = remote.credentialOwner;
  if (nestedOwner !== undefined && nestedOwner !== 'saul') throw invalid('API credential owner');
  if (credentialOwner === 'local' && nestedOwner === 'saul')
    throw invalid('conflicting credential owners');
  if (credentialOwner === 'saul' || nestedOwner === 'saul') {
    if (!key) {
      if (!officialOpenAI(baseUrl)) throw new Error(SELECT_NEW_PRESET);
      return { ...api, owner: 'saul', binding: { kind: 'legacy-official' } };
    }
    if (!validConnectionEndpoint(baseUrl) && !(key === 'openai-api' && officialOpenAI(baseUrl)))
      throw invalid('managed API endpoint');
    return { ...api, owner: 'saul', binding: { kind: 'connection', key } };
  }
  return { ...api, owner: 'local', binding: { kind: 'profile', id: profile } };
}

/** Original Summarize predates presets. Only a saved signed registration can use its account alone. */
export function originalSummaryPlan(value: {
  accountId: unknown;
  model: unknown;
  effort?: unknown;
  credentialOwner?: unknown;
  connectionKey?: unknown;
}): PlanExecution {
  if (value.credentialOwner !== 'saul') throw new Error(SELECT_NEW_PRESET);
  const binding: PlanExecution['binding'] =
    value.connectionKey === undefined
      ? { kind: 'legacy-account' }
      : { kind: 'connection', key: connectionKey(value.connectionKey) };
  return {
    provider: 'chatgpt-plan',
    owner: 'saul',
    capability: 'write',
    binding,
    plan: planChoices(value),
  };
}
