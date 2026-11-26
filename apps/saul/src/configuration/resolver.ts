import type { ModelPreset } from '../../shared/model/presets.ts';
import { configurationFor, type Configuration } from './definition';
import {
  executionModel,
  SELECT_NEW_PRESET,
  validateAPIPresetOptions,
  validateEndpoint,
  type FrozenModel,
} from '../../shared/model/execution-route.ts';
import { officialOpenAI } from '../../shared/protocol/credentials-contract.mts';
import { inspectPreset, type PresetInspection } from './inspect';
import { activeConnections } from './connections';
import { CHROME_AI_RETIRED_MESSAGE } from '../../shared/model/retired-provider.ts';

export { SELECT_NEW_PRESET } from '../../shared/model/execution-route.ts';

export interface PreparedModel {
  choices: FrozenModel;
  credential: string;
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

function resolveSelection(
  settings: Configuration,
  preset: ModelPreset,
  frozenProfileId?: string,
): PresetInspection {
  const selected = inspectPreset(settings, preset, frozenProfileId);
  if (selected.issue) throw new Error(selected.issue);
  const { connection } = selected;
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
      !selected.hasExplicitProfile
    )
      throw new Error(
        `Preset “${preset.name}” needs its saved connection. Choose a connection in Settings.`,
      );
  } else if (preset.provider === 'openai-compatible')
    validateAPIPresetOptions(preset.effort, preset.fast);
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
  const credential = credentialForChoices(settings, original);
  return { input: structuredClone(original), credential };
}
function credentialForChoices(settings: Configuration, input: FrozenModel): string {
  const route = executionModel(input);
  if (route.provider === 'chatgpt-plan') {
    if (settings.sharedCredentials !== 'saul' || route.binding.kind !== 'connection')
      throw new Error(SELECT_NEW_PRESET);
    const key = route.binding.key;
    const connection = activeConnections(settings).find((item) => item.key === key);
    if (
      connection?.kind !== 'chatgpt-plan' ||
      !connection.accountId ||
      connection.accountId !== route.plan.accountId
    )
      throw new Error(SELECT_NEW_PRESET);
    return '';
  }
  const endpoint = new URL(route.endpoint);
  if (!input.preset) throw new Error(SELECT_NEW_PRESET);
  if (route.binding.kind === 'connection') {
    const key = route.binding.key;
    const connection = activeConnections(settings).find((item) => item.key === key);
    const bound = connection?.baseUrl ?? 'https://api.openai.com/v1';
    if (
      connection?.kind !== 'openai-api' ||
      (route.endpoint !== bound &&
        !(
          key === 'openai-api' &&
          bound === 'https://api.openai.com/v1' &&
          officialOpenAI(route.endpoint)
        ))
    )
      throw new Error(SELECT_NEW_PRESET);
  }
  const selected = resolveSelection(
    settings,
    input.preset,
    route.owner === 'local' ? route.binding.id : input.preset.profileId,
  );
  const currentEndpoint = validateSelection(selected, settings.sharedCredentials)!;
  if (currentEndpoint.href !== endpoint.href) throw new Error(SELECT_NEW_PRESET);
  if (route.owner !== (selected.remote.credentialOwner ?? 'local'))
    throw new Error(SELECT_NEW_PRESET);
  if (route.owner === 'saul') return '';
  if (selected.profileId !== route.binding.id) throw new Error(SELECT_NEW_PRESET);
  if (!selected.remote.apiKey && !loopback(endpoint))
    throw new Error('API key is missing. Configure it in Saul Settings.');
  return selected.remote.apiKey;
}

export function prepareWritePreset(settings: Configuration, presetId: string) {
  const preset = configurationFor(settings).presets.find((p) => p.id === presetId);
  if (!preset) throw new Error('Choose an existing saved preset in Settings → Presets.');
  return preparePreset(settings, preset, 'write');
}
