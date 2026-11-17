import type { Configuration, ModelPreset } from './definition';
import type { FrozenModel } from '../providers/request';
import { inspectPreset, type PresetInspection } from './inspect';
import { CHROME_AI_RETIRED_MESSAGE } from '../providers/retired-provider';

export const SELECT_NEW_PRESET =
  'The saved connection has changed. Select a new preset in Settings, then start a new attempt.';

export interface PreparedModel {
  choices: FrozenModel;
  credential: string;
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
export function validateSettingsConnections(settings: Configuration): void {
  for (const profile of settings.profiles ?? [])
    if (profile.config.baseUrl) validateEndpoint(profile.config.baseUrl);
}
function validateSelection(
  selected: PresetInspection,
  mode: Configuration['sharedCredentials'],
): URL | undefined {
  if (
    (selected.remote.credentialOwner === 'saul' && mode !== 'saul') ||
    (selected.provider === 'chatgpt-plan' && mode !== 'saul') ||
    (mode === 'disconnected' &&
      selected.provider === 'openai-compatible' &&
      !!selected.preset?.connectionKey)
  )
    throw new Error('Connect this app in Settings → Preferences → Integrations.');
  if (selected.provider === 'chrome-ai') throw new Error(CHROME_AI_RETIRED_MESSAGE);
  if (selected.provider === 'chatgpt-plan') {
    if (!selected.plan?.accountId || !selected.plan.model.trim())
      throw new Error('Choose a ChatGPT account and model.');
    return undefined;
  }
  const endpoint = validateEndpoint(selected.remote.baseUrl);
  if (!selected.remote.model.trim())
    throw new Error('Enter a model name available from this provider.');
  return endpoint;
}
function loopback(endpoint: URL) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
}

function resolveSelection(settings: Configuration, preset: ModelPreset): PresetInspection {
  const selected = inspectPreset(settings, preset);
  if (selected.issue) throw new Error(selected.issue);
  const connection = settings.connections.find((c) => c.key === preset.connectionKey);
  if (preset.capability === 'draw' || preset.capability === 'speak') {
    const capability = preset.capability === 'draw' ? 'Draw' : 'Speak';
    if (preset.provider !== 'openai-compatible' || connection?.kind !== 'openai-api')
      throw new Error(`${capability} requires an OpenAI API connection. Open Connections.`);
    if (selected.remote.baseUrl.replace(/\/+$/, '') !== 'https://api.openai.com/v1')
      throw new Error(
        `${capability} requires a connection to https://api.openai.com/v1. Choose it in Connections.`,
      );
    if (
      preset.capability === 'speak' &&
      settings.sharedCredentials !== 'saul' &&
      !settings.profiles?.some((p) => p.id === selected.profileId)
    )
      throw new Error(
        `Preset “${preset.name}” needs its saved connection. Choose a connection in Settings.`,
      );
  } else if (preset.provider === 'openai-compatible' && (preset.effort || preset.fast))
    throw new Error(
      "The preset requests reasoning or Fast options that Saul's API connection does not support. Run it in EZ or choose a supported preset.",
    );
  if (
    preset.provider === 'chatgpt-plan' &&
    settings.sharedCredentials === 'saul' &&
    !connection?.accountId
  )
    throw new Error('Choose an account for this connection in Settings → Connections.');
  return selected;
}

/** Freeze a concrete selection; credentials stay outside the persistable choices. */
export function preparePreset(
  settings: Configuration,
  preset: ModelPreset,
  capability: 'write' | 'draw' | 'speak' = 'write',
  inspectOnly = false,
): PreparedModel {
  if ((preset.capability ?? 'write') !== capability)
    throw new Error(
      `Preset “${preset.name}” uses ${preset.capability}. Choose a ${capability[0]!.toUpperCase() + capability.slice(1)} preset.`,
    );
  const selected = resolveSelection(settings, preset);
  if (!inspectOnly) validateSelection(selected, settings.sharedCredentials);
  const remote: FrozenModel['remote'] = {
    baseUrl: selected.remote.baseUrl,
    model: selected.remote.model,
    temperature: selected.remote.temperature,
    ...(selected.remote.credentialOwner
      ? { credentialOwner: selected.remote.credentialOwner }
      : {}),
  };
  const choices: FrozenModel = {
    provider: selected.provider,
    remote,
    local: structuredClone(selected.local),
    preset: {
      ...structuredClone(preset),
      ...(selected.provider === 'openai-compatible' ? { profileId: selected.profileId } : {}),
    },
    ...(selected.provider === 'chatgpt-plan'
      ? {
          plan: structuredClone(selected.plan),
          credentialOwner: settings.sharedCredentials === 'saul' ? 'saul' : 'local',
        }
      : {}),
  };
  return { choices, credential: inspectOnly ? '' : credentialForChoices(settings, choices) };
}
export function prepareFrozenPreset<T extends FrozenModel>(
  settings: Configuration,
  original: T,
): { input: T; credential: string } {
  const input = structuredClone(original);
  return { input, credential: credentialForChoices(settings, input) };
}
function credentialForChoices(settings: Configuration, input: FrozenModel): string {
  if (input.provider === 'chatgpt-plan') {
    if (input.credentialOwner !== 'saul' || settings.sharedCredentials !== 'saul')
      throw new Error(SELECT_NEW_PRESET);
    const connection = settings.connections.find(
      (item) => item.key === input.preset?.connectionKey,
    );
    if (
      connection?.kind !== 'chatgpt-plan' ||
      !connection.accountId ||
      connection.accountId !== input.plan?.accountId
    )
      throw new Error(SELECT_NEW_PRESET);
    validateSelection(
      {
        provider: input.provider,
        plan: input.plan,
        remote: { ...input.remote, apiKey: '' },
        local: input.local,
      },
      settings.sharedCredentials,
    );
    return '';
  }
  if (input.provider === 'chrome-ai') throw new Error(CHROME_AI_RETIRED_MESSAGE);
  const endpoint = new URL(input.remote.baseUrl);
  if (!input.preset) throw new Error(SELECT_NEW_PRESET);
  const frozenSettings =
    input.preset.connectionKey && input.preset.profileId
      ? {
          ...settings,
          connectionProfiles: {
            ...settings.connectionProfiles,
            [input.preset.connectionKey]: input.preset.profileId,
          },
        }
      : settings;
  const selected = resolveSelection(frozenSettings, input.preset);
  const currentEndpoint = validateSelection(selected, settings.sharedCredentials)!;
  if (currentEndpoint.href !== endpoint.href) throw new Error(SELECT_NEW_PRESET);
  if (
    (input.credentialOwner ?? input.remote.credentialOwner ?? 'local') !==
    (selected.remote.credentialOwner ?? 'local')
  )
    throw new Error(SELECT_NEW_PRESET);
  if (selected.remote.credentialOwner === 'saul') return '';
  if (!selected.remote.apiKey && !loopback(endpoint))
    throw new Error('API key is missing. Configure it in Saul Settings.');
  return selected.remote.apiKey;
}
