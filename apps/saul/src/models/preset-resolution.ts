import type { ModelPreset, UserSettings } from '../types';
import type { RunInput } from '../types/storage';
import { isLoopbackEndpoint, validateProviderSettings } from '../storage/settings';

export const SELECT_NEW_PRESET =
  'The saved connection has changed. Select a new preset in Settings, then start a new attempt.';
type Choices = Pick<
  RunInput,
  'provider' | 'remote' | 'local' | 'plan' | 'preset' | 'credentialOwner'
>;

/** Editing may retain unavailable choices; it never resolves execution credentials. */
export function projectPresetForEditing(settings: UserSettings, preset: ModelPreset): UserSettings {
  return projectPreset(settings, preset, true);
}

/** Resolve a capability and its explicit connection once, without exposing editor state. */
export function preparePreset(
  settings: UserSettings,
  preset: ModelPreset,
  capability: 'write' | 'draw' | 'speak' = 'write',
  inspectOnly = false,
): { choices: Choices; credential: string } {
  if ((preset.capability ?? 'write') !== capability) {
    throw new Error(
      `Preset “${preset.name}” uses ${preset.capability}. Choose a ${capability[0]!.toUpperCase() + capability.slice(1)} preset.`,
    );
  }
  const selected =
    capability !== 'write' ? mediaSettings(settings, preset) : projectPreset(settings, preset);
  if (!inspectOnly) validateProviderSettings(selected);
  const remote: Choices['remote'] = {
    baseUrl: selected.openaiCompatible.baseUrl,
    model: selected.openaiCompatible.model,
    temperature: selected.openaiCompatible.temperature,
    ...(selected.openaiCompatible.credentialOwner
      ? { credentialOwner: selected.openaiCompatible.credentialOwner }
      : {}),
  };
  const choices: Choices = {
    provider: selected.activeProvider,
    remote,
    local: structuredClone(selected.chromeAi),
    preset: {
      ...structuredClone(preset),
      ...(selected.activeProvider === 'openai-compatible'
        ? { profileId: selected.activeProfileId }
        : {}),
    },
    ...(selected.activeProvider === 'chatgpt-plan'
      ? {
          plan: structuredClone(selected.chatgptPlan),
          credentialOwner: settings.sharedCredentials === 'saul' ? 'saul' : 'local',
        }
      : {}),
  };
  return { choices, credential: inspectOnly ? '' : credentialForChoices(settings, choices) };
}

/** Retry retains every saved choice; a route change requires a new explicit attempt. */
export function prepareFrozenPreset(
  settings: UserSettings,
  original: RunInput,
): { input: RunInput; credential: string } {
  const input = structuredClone(original);
  return { input, credential: credentialForChoices(settings, input) };
}

function credentialForChoices(settings: UserSettings, input: Choices): string {
  if (input.provider === 'chatgpt-plan') {
    const current = settings.sharedCredentials === 'saul' ? 'saul' : 'local';
    if ((input.credentialOwner ?? 'local') !== current) throw new Error(SELECT_NEW_PRESET);
    validateProviderSettings({
      ...settings,
      activeProvider: 'chatgpt-plan',
      chatgptPlan: input.plan,
    });
    return '';
  }
  if (input.provider === 'chrome-ai') {
    validateProviderSettings({ ...settings, activeProvider: 'chrome-ai' });
    return '';
  }
  const endpoint = new URL(input.remote.baseUrl);
  if (!input.preset) {
    if (isLoopbackEndpoint(endpoint)) return '';
    throw new Error(SELECT_NEW_PRESET);
  }
  const frozenSettings =
    input.preset.providerKey && input.preset.profileId
      ? {
          ...settings,
          providerConnections: {
            ...settings.providerConnections,
            [input.preset.providerKey]: input.preset.profileId,
          },
        }
      : settings;
  const selected =
    input.preset.capability === 'speak' || input.preset.capability === 'draw'
      ? mediaSettings(frozenSettings, input.preset)
      : projectPreset(frozenSettings, input.preset);
  const currentEndpoint = validateProviderSettings(selected)!;
  if (currentEndpoint.href !== endpoint.href) throw new Error(SELECT_NEW_PRESET);
  const owner = input.credentialOwner ?? input.remote.credentialOwner ?? 'local';
  if (owner !== (selected.openaiCompatible.credentialOwner ?? 'local'))
    throw new Error(SELECT_NEW_PRESET);
  if (owner === 'saul') return '';
  const key = selected.openaiCompatible.apiKey;
  if (!key && !isLoopbackEndpoint(endpoint))
    throw new Error('API key is missing. Configure it in Saul Settings.');
  return key;
}

function mediaSettings(settings: UserSettings, preset: ModelPreset): UserSettings {
  const capability = preset.capability === 'draw' ? 'Draw' : 'Speak';
  const provider = settings.providers.find((p) => p.key === preset.providerKey);
  if (preset.provider !== 'openai-compatible' || provider?.kind !== 'openai-api')
    throw new Error(`${capability} requires an OpenAI API provider. Open Providers.`);
  const source = connectionForPreset(settings, preset, false, preset.capability === 'draw');
  if (source.config.baseUrl.replace(/\/+$/, '') !== 'https://api.openai.com/v1')
    throw new Error(
      `${capability} requires a connection to https://api.openai.com/v1. Choose it in Providers.`,
    );
  return {
    ...settings,
    activeProvider: 'openai-compatible',
    activeProfileId: source.id,
    openaiCompatible: { ...source.config, model: preset.model },
  };
}

function connectionForPreset(
  settings: UserSettings,
  preset: ModelPreset,
  editing = false,
  allowImplicit = true,
): { id: string | undefined; config: UserSettings['openaiCompatible'] } {
  const id = preset.providerKey
    ? settings.providerConnections?.[preset.providerKey] || preset.profileId
    : preset.profileId;
  const profile = settings.profiles?.find((profile) => profile.id === id);
  const implicit =
    allowImplicit && !settings.profiles && id === (settings.activeProfileId || 'default');
  const config =
    profile?.config ||
    (implicit
      ? settings.openaiCompatible
      : editing
        ? { baseUrl: '', apiKey: '', model: preset.model, temperature: preset.temperature ?? 0.3 }
        : undefined);
  if (!config)
    throw new Error(
      `Preset “${preset.name}” needs its saved connection. Choose a connection in Settings.`,
    );
  return { id, config };
}

function projectPreset(settings: UserSettings, preset: ModelPreset, editing = false): UserSettings {
  if ((preset.capability === 'draw' || preset.capability === 'speak') && editing) return settings;
  if (preset.capability === 'speak')
    throw new Error(
      `Preset “${preset.name}” uses Speak. Open its speech preview in Presets; choose a Write preset for reading actions.`,
    );
  if (preset.capability === 'draw' && !editing)
    throw new Error(`Preset “${preset.name}” uses Draw. Choose it for an Illustrate action.`);
  if (preset.providerKey && settings.providers) {
    const provider = settings.providers.find((item) => item.key === preset.providerKey);
    if (!provider && !editing)
      throw new Error(`Provider “${preset.providerKey}” is unavailable. Open Providers.`);
    if (
      provider &&
      (provider.kind === 'chatgpt-plan' ? 'chatgpt-plan' : 'openai-compatible') !==
        preset.provider &&
      !editing
    )
      throw new Error('The preset provider changed. Reload settings before running.');
  }
  if (preset.provider === 'openai-compatible') {
    if (!editing && (preset.effort || preset.fast))
      throw new Error(
        `Preset “${preset.name}” requests reasoning or Fast options that Saul's API connection does not support. Run it in EZ or choose a supported preset.`,
      );
    const { id: connectionId, config: source } = connectionForPreset(settings, preset, editing);
    return {
      ...settings,
      activeProvider: preset.provider,
      activeProfileId: connectionId,
      openaiCompatible: {
        ...source,
        model: preset.model,
        temperature: preset.temperature ?? source.temperature,
      },
    };
  }
  if (preset.provider === 'chatgpt-plan') {
    return {
      ...settings,
      activeProvider: preset.provider,
      chatgptPlan: {
        accountId: settings.chatgptPlan?.accountId || '',
        model: preset.model,
        ...(preset.effort === undefined ? {} : { effort: preset.effort }),
        ...(preset.fast === undefined ? {} : { fast: preset.fast }),
      },
    };
  }
  return {
    ...settings,
    activeProvider: preset.provider,
    chromeAi: {
      temperature: preset.temperature ?? settings.chromeAi.temperature,
      topK: preset.topK ?? settings.chromeAi.topK,
    },
  };
}
