import {
  DEFAULT_PROVIDERS,
  SPEECH_MODEL,
  validateSharedProviders,
} from '../../native/shared-presets-contract.mts';
import type { ModelPreset, ProviderType, Recipe, UserSettings } from '../types';
import { DEFAULT_SETTINGS, validateSettingsConnections } from '../storage/settings';
import {
  configurationFor,
  DEFAULT_RECIPE_SYSTEM_PROMPT,
  presetFromSettings,
  settingsForPreset,
  validateConfiguration,
} from './configuration';

export interface SettingsDraft {
  settings: UserSettings;
  presetId: string;
  recipeId: string;
}

export type SettingsEdit =
  | { type: 'settings'; patch: Partial<UserSettings> }
  | { type: 'select-preset'; id: string }
  | { type: 'add-preset'; id: string }
  | { type: 'preset-name'; name: string }
  | { type: 'provider-name'; key: string; name: string }
  | { type: 'preset-provider'; key: string }
  | { type: 'preset-local-provider'; provider: Exclude<ProviderType, 'chatgpt-plan'> }
  | {
      type: 'preset';
      patch: Partial<
        Pick<
          ModelPreset,
          'model' | 'capability' | 'effort' | 'fast' | 'temperature' | 'speechOptions'
        >
      >;
    }
  | {
      type: 'connection';
      id: string;
      patch: Partial<Pick<UserSettings['openaiCompatible'], 'baseUrl' | 'apiKey'>>;
      name?: string;
    }
  | { type: 'provider-connection'; key: string; profileId: string }
  | { type: 'plan-account'; accountId: string }
  | { type: 'add-connection'; id: string }
  | { type: 'preset-profile'; id: string }
  | { type: 'remove-preset' }
  | { type: 'select-recipe'; id: string }
  | { type: 'add-recipe'; id: string }
  | { type: 'recipe'; patch: Partial<Recipe> }
  | { type: 'default-recipe'; id: string }
  | { type: 'remove-recipe' };

function nextName(base: string, items: { name: string }[]): string {
  let name = base;
  for (
    let suffix = 2;
    items.some((item) => item.name.toLowerCase() === name.toLowerCase());
    suffix++
  )
    name = `${base} ${suffix}`;
  return name;
}

function origin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/** Own the editable projection; selecting a preset never loses the previous profile. */
export function createSettingsDraft(source: UserSettings): SettingsDraft {
  const settings = structuredClone(source);
  const activeProfileId = settings.activeProfileId || 'default';
  const configuration = configurationFor(settings);
  const recipe = configuration.recipes.find((item) => item.id === configuration.selectedRecipeId)!;
  const preset =
    configuration.presets.find((item) => item.id === recipe.presetId) ?? configuration.presets[0];
  const normalized = {
    ...settings,
    activeProfileId,
    profiles: settings.profiles?.length
      ? settings.profiles
      : [{ id: activeProfileId, name: 'Default', config: { ...settings.openaiCompatible } }],
    configuration,
  };
  return {
    settings: preset ? settingsForPreset(normalized, preset, true) : normalized,
    presetId: preset?.id ?? '',
    recipeId: recipe.id,
  };
}

/** Views supply edits; presets and connections retain separate owners. */
export function editSettingsDraft(draft: SettingsDraft, edit: SettingsEdit): SettingsDraft {
  const settings = draft.settings;
  const configuration = configurationFor(settings);
  switch (edit.type) {
    case 'add-connection': {
      if ((settings.profiles?.length ?? 0) >= 32)
        throw new Error('Keep at most 32 API connections.');
      return {
        ...draft,
        settings: {
          ...settings,
          profiles: [
            ...(settings.profiles ?? []),
            {
              id: edit.id,
              name: nextName('New connection', settings.profiles ?? []),
              config: { ...DEFAULT_SETTINGS.openaiCompatible },
            },
          ],
        },
      };
    }
    case 'preset-profile': {
      if (!settings.profiles?.some((p) => p.id === edit.id))
        throw new Error('Choose an existing connection.');
      const next = {
        ...settings,
        configuration: {
          ...configuration,
          presets: configuration.presets.map((p) =>
            p.id === draft.presetId ? { ...p, profileId: edit.id } : p,
          ),
        },
      };
      return {
        ...draft,
        settings: settingsForPreset(
          next,
          next.configuration.presets.find((p) => p.id === draft.presetId)!,
          true,
        ),
      };
    }
    case 'plan-account':
      return {
        ...draft,
        settings: {
          ...settings,
          chatgptPlan: { ...(settings.chatgptPlan ?? { model: '' }), accountId: edit.accountId },
        },
      };
    case 'connection': {
      const profile = settings.profiles?.find((p) => p.id === edit.id);
      if (!profile) throw new Error('Choose an existing connection.');
      const config = { ...profile.config, ...edit.patch };
      if (origin(config.baseUrl) !== origin(profile.config.baseUrl)) config.apiKey = '';
      return {
        ...draft,
        settings: {
          ...settings,
          ...(settings.activeProfileId === profile.id
            ? {
                openaiCompatible: {
                  ...settings.openaiCompatible,
                  baseUrl: config.baseUrl,
                  apiKey: config.apiKey,
                },
              }
            : {}),
          profiles: settings.profiles?.map((p) =>
            p.id === profile.id
              ? { ...p, config, ...(edit.name === undefined ? {} : { name: edit.name }) }
              : p,
          ),
        },
      };
    }
    case 'provider-connection': {
      if (!settings.profiles?.some((p) => p.id === edit.profileId))
        throw new Error('Choose an existing connection.');
      return {
        ...draft,
        settings: {
          ...settings,
          providerConnections: { ...settings.providerConnections, [edit.key]: edit.profileId },
        },
      };
    }
    case 'preset': {
      const preset = configuration.presets.find((p) => p.id === draft.presetId);
      if (!preset) throw new Error('Choose an existing preset.');
      const updated = { ...preset, ...edit.patch };
      if (edit.patch.capability === 'speak' && preset.capability !== 'speak')
        Object.assign(updated, {
          model: SPEECH_MODEL,
          effort: '',
          fast: false,
          speechOptions: { voice: 'marin' },
        });
      const next = {
        ...settings,
        configuration: {
          ...configuration,
          presets: configuration.presets.map((p) => (p.id === preset.id ? updated : p)),
        },
      };
      return { ...draft, settings: settingsForPreset(next, updated, true) };
    }
    case 'provider-name':
      return {
        ...draft,
        settings: {
          ...settings,
          providers: (settings.providers ?? DEFAULT_PROVIDERS).map((provider) =>
            provider.key === edit.key ? { ...provider, name: edit.name } : provider,
          ),
        },
      };
    case 'preset-provider': {
      const provider = (settings.providers ?? DEFAULT_PROVIDERS).find(
        (item) => item.key === edit.key,
      );
      const preset = configuration.presets.find((item) => item.id === draft.presetId);
      if (!provider || !preset) throw new Error('Choose an available provider.');
      const kind = provider.kind === 'chatgpt-plan' ? 'chatgpt-plan' : 'openai-compatible';
      const choices =
        preset.provider === kind
          ? preset
          : presetFromSettings({ ...settings, activeProvider: kind }, preset.id, preset.name);
      const updated = {
        ...preset,
        model: choices.model,
        effort: choices.effort,
        fast: choices.fast,
        temperature: choices.temperature,
        topK: choices.topK,
        shared: settings.sharedPresetRevision !== undefined,
        providerKey: provider.key,
        provider:
          provider.kind === 'chatgpt-plan'
            ? ('chatgpt-plan' as const)
            : ('openai-compatible' as const),
        profileId:
          provider.kind === 'openai-api'
            ? settings.providerConnections?.[provider.key] ||
              (settings.openaiCompatible.baseUrl.replace(/\/+$/, '') === 'https://api.openai.com/v1'
                ? settings.activeProfileId
                : undefined) ||
              provider.key
            : undefined,
      };
      const configured = {
        ...settings,
        configuration: {
          ...configuration,
          presets: configuration.presets.map((item) => (item.id === preset.id ? updated : item)),
        },
      };
      return { ...draft, settings: settingsForPreset(configured, updated, true) };
    }
    case 'settings':
      return { ...draft, settings: { ...settings, ...edit.patch } };
    case 'preset-local-provider': {
      const preset = configuration.presets.find((p) => p.id === draft.presetId);
      if (!preset) throw new Error('Choose an existing preset.');
      const choices = presetFromSettings(
        { ...settings, activeProvider: edit.provider },
        preset.id,
        preset.name,
      );
      const updated = {
        ...preset,
        ...choices,
        providerKey: undefined,
        shared: undefined,
        effort: choices.effort,
        fast: choices.fast,
        temperature: choices.temperature,
        topK: choices.topK,
      };
      const next = {
        ...settings,
        configuration: {
          ...configuration,
          presets: configuration.presets.map((p) => (p.id === preset.id ? updated : p)),
        },
      };
      return { ...draft, settings: settingsForPreset(next, updated, true) };
    }
    case 'select-preset': {
      const preset = configuration.presets.find((item) => item.id === edit.id);
      if (!preset) throw new Error('Choose an existing preset.');
      return {
        ...draft,
        settings: settingsForPreset(settings, preset, true),
        presetId: preset.id,
      };
    }
    case 'add-preset':
      if (configuration.presets.length >= 32) throw new Error('Keep at most 32 presets.');
      return {
        ...draft,
        presetId: edit.id,
        settings: {
          ...settings,
          configuration: {
            ...configuration,
            presets: [
              ...configuration.presets,
              presetFromSettings(settings, edit.id, nextName('New preset', configuration.presets)),
            ],
          },
        },
      };
    case 'preset-name':
      return {
        ...draft,
        settings: {
          ...settings,
          configuration: {
            ...configuration,
            presets: configuration.presets.map((item) =>
              item.id === draft.presetId ? { ...item, name: edit.name } : item,
            ),
          },
        },
      };
    case 'remove-preset': {
      const used = configuration.recipes.filter((recipe) => recipe.presetId === draft.presetId);
      if (used.length)
        throw new Error(
          `This preset is used by ${used.map((recipe) => recipe.name).join(', ')}. Choose another default preset for those actions first.`,
        );
      const presets = configuration.presets.filter((preset) => preset.id !== draft.presetId);
      if (!presets.length) throw new Error('Keep at least one preset.');
      return {
        ...draft,
        presetId: presets[0]!.id,
        settings: settingsForPreset(
          { ...settings, configuration: { ...configuration, presets } },
          presets[0]!,
          true,
        ),
      };
    }
    case 'select-recipe':
      if (!configuration.recipes.some((recipe) => recipe.id === edit.id))
        throw new Error('Choose an existing action.');
      return { ...draft, recipeId: edit.id };
    case 'add-recipe': {
      const writing =
        configuration.presets.find(
          (p) => p.id === draft.presetId && (!p.capability || p.capability === 'write'),
        ) ?? configuration.presets.find((p) => !p.capability || p.capability === 'write');
      if (!writing) throw new Error('Add a Write preset before adding a reading action.');
      if (configuration.recipes.length >= 32) throw new Error('Keep at most 32 actions.');
      return {
        ...draft,
        recipeId: edit.id,
        settings: {
          ...settings,
          configuration: {
            ...configuration,
            recipes: [
              ...configuration.recipes,
              {
                id: edit.id,
                name: nextName('New action', configuration.recipes),
                presetId: writing.id,
                template: '{{text}}',
                systemPrompt: DEFAULT_RECIPE_SYSTEM_PROMPT,
              },
            ],
          },
        },
      };
    }
    case 'recipe':
      return {
        ...draft,
        settings: {
          ...settings,
          configuration: {
            ...configuration,
            recipes: configuration.recipes.map((recipe) =>
              recipe.id === draft.recipeId ? { ...recipe, ...edit.patch, id: recipe.id } : recipe,
            ),
          },
        },
      };
    case 'default-recipe':
      if (!configuration.recipes.some((recipe) => recipe.id === edit.id))
        throw new Error('Choose an existing default action.');
      return {
        ...draft,
        settings: { ...settings, configuration: { ...configuration, selectedRecipeId: edit.id } },
      };
    case 'remove-recipe':
      if (draft.recipeId === configuration.selectedRecipeId)
        throw new Error('Choose another default action before removing this one.');
      return {
        ...draft,
        recipeId: configuration.selectedRecipeId,
        settings: {
          ...settings,
          configuration: {
            ...configuration,
            recipes: configuration.recipes.filter((recipe) => recipe.id !== draft.recipeId),
          },
        },
      };
  }
}

export function settingsForSave(draft: SettingsDraft): UserSettings {
  const settings = draft.settings;
  const selected = configurationFor(settings).presets.find((p) => p.id === draft.presetId);
  if (selected && !selected.model.trim())
    throw new Error('Enter a model name available from this provider.');
  validateConfiguration(configurationFor(settings), settings.sharedPresetRevision !== undefined);
  validateSettingsConnections(settings);
  if (settings.providers) validateSharedProviders(settings.providers);
  return structuredClone(settings);
}
