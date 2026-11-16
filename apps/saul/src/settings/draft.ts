import { inspectPreset } from '../configuration/inspect';
import { validateConnections } from '../../native/shared-presets-contract.mts';
import { officialOpenAI } from '../../native/credentials-contract.mts';
import type { ModelPreset, ProviderType, Recipe, Configuration } from '../configuration/definition';
import { DEFAULT_CONFIGURATION } from '../configuration/definition';
import { validateSettingsConnections } from '../configuration/resolve';
import {
  configurationFor,
  illustrationPreset,
  illustrationRecipe,
  DEFAULT_RECIPE_SYSTEM_PROMPT,
  presetFromSelection,
  validateConfiguration,
} from '../configuration/definition';

type RetainedSettings = Pick<
  Configuration,
  | 'activeProvider'
  | 'activeProfileId'
  | 'openaiCompatible'
  | 'chromeAi'
  | 'sharedPresetRevision'
  | 'scopedConfigRevision'
>;

export type SettingsValues = Omit<Configuration, keyof RetainedSettings | 'chatgptPlan'> & {
  profiles: NonNullable<Configuration['profiles']>;
  configuration: NonNullable<Configuration['configuration']>;
  planAccountId?: string;
};

export type SettingsPreferences = Pick<
  Configuration,
  'responseLanguage' | 'contextPolicy' | 'summaryPresetId' | 'summaryPdfProcessing'
>;

export interface SettingsDraft {
  values: SettingsValues;
  /** Transport defaults are not the inspected preset or a second editable connection. */
  retained: Readonly<
    RetainedSettings & {
      planOptions?: Omit<NonNullable<Configuration['chatgptPlan']>, 'accountId'>;
      activeProfileConfig?: Readonly<Configuration['openaiCompatible']>;
    }
  >;
  presetId: string;
  recipeId: string;
}

export type SettingsEdit =
  | { type: 'settings'; patch: Partial<SettingsPreferences> }
  | { type: 'select-preset'; id: string }
  | { type: 'add-preset'; id: string }
  | { type: 'preset-name'; name: string }
  | { type: 'connection-name'; key: string; name: string }
  | { type: 'preset-connection'; key: string }
  | { type: 'preset-local-provider'; provider: Exclude<ProviderType, 'chatgpt-plan'> }
  | {
      type: 'preset';
      patch: Partial<
        Pick<
          ModelPreset,
          | 'model'
          | 'capability'
          | 'effort'
          | 'fast'
          | 'temperature'
          | 'speechOptions'
          | 'imageOptions'
        >
      >;
    }
  | {
      type: 'connection';
      id: string;
      patch: Partial<Pick<Configuration['openaiCompatible'], 'baseUrl' | 'apiKey'>>;
      name?: string;
    }
  | { type: 'connection-profile'; key: string; profileId: string }
  | { type: 'plan-account'; accountId: string }
  | { type: 'add-connection'; id: string }
  | { type: 'preset-profile'; id: string }
  | { type: 'remove-preset' }
  | { type: 'select-recipe'; id: string }
  | { type: 'add-recipe'; id: string }
  | { type: 'add-illustrate' }
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

/** Keep editable records, transport defaults and inspection selection distinct. */
export function createSettingsDraft(
  source: Configuration,
  previous?: SettingsDraft,
): SettingsDraft {
  const settings = structuredClone(source);
  const {
    activeProvider,
    activeProfileId: savedProfileId,
    openaiCompatible,
    chromeAi,
    chatgptPlan,
    sharedPresetRevision,
    scopedConfigRevision,
    ...values
  } = settings;
  const activeProfileId = savedProfileId || 'default';
  const configuration = configurationFor(settings);
  const recipe = configuration.recipes.find((item) => item.id === configuration.selectedRecipeId)!;
  const preset =
    configuration.presets.find((item) => item.id === recipe.presetId) ?? configuration.presets[0];
  const selected = previous?.values.configuration.presets.find((p) => p.id === previous.presetId);
  const restored =
    configuration.presets.find((p) => p.id === previous?.presetId) ??
    (selected &&
      configuration.presets.find(
        (p) => p.name === selected.name && p.provider === selected.provider,
      ));
  const editable = {
    ...values,
    profiles: settings.profiles?.length
      ? settings.profiles
      : [{ id: activeProfileId, name: 'Default', config: { ...settings.openaiCompatible } }],
    configuration,
    planAccountId: chatgptPlan?.accountId,
  };
  const planOptions = chatgptPlan && {
    model: chatgptPlan.model,
    ...(chatgptPlan.effort === undefined ? {} : { effort: chatgptPlan.effort }),
    ...(chatgptPlan.fast === undefined ? {} : { fast: chatgptPlan.fast }),
  };
  return {
    values: editable,
    retained: {
      activeProvider,
      activeProfileId,
      openaiCompatible,
      chromeAi,
      sharedPresetRevision,
      scopedConfigRevision,
      planOptions,
      activeProfileConfig: editable.profiles.find((p) => p.id === activeProfileId)?.config,
    },
    presetId: restored?.id ?? preset?.id ?? '',
    recipeId: configuration.recipes.some((r) => r.id === previous?.recipeId)
      ? previous!.recipeId
      : recipe.id,
  };
}

/** One transport boundary for views and commits; inspection never participates. */
export function settingsFromDraft(draft: SettingsDraft): Configuration {
  const { planAccountId, ...values } = draft.values;
  const { planOptions, activeProfileConfig, ...retained } = draft.retained;
  const profile = values.profiles.find((p) => p.id === retained.activeProfileId)?.config;
  const changedRoute =
    profile &&
    activeProfileConfig &&
    (profile.baseUrl !== activeProfileConfig.baseUrl ||
      profile.apiKey !== activeProfileConfig.apiKey ||
      profile.credentialOwner !== activeProfileConfig.credentialOwner);
  return {
    ...retained,
    ...values,
    openaiCompatible: changedRoute
      ? {
          ...retained.openaiCompatible,
          baseUrl: profile.baseUrl,
          apiKey: profile.apiKey,
          credentialOwner: profile.credentialOwner,
        }
      : retained.openaiCompatible,
    ...(planOptions || planAccountId !== undefined
      ? {
          chatgptPlan: {
            ...planOptions,
            model: planOptions?.model ?? '',
            accountId: planAccountId ?? '',
          },
        }
      : {}),
  };
}

/** Ephemeral view only. Missing/unavailable choices remain editable. */
export function inspectDraftPreset(draft: SettingsDraft) {
  const settings = settingsFromDraft(draft);
  const preset = draft.values.configuration.presets.find((p) => p.id === draft.presetId);
  return inspectPreset(settings, preset);
}

/** Views supply edits; presets and connections retain separate owners. */
export function editSettingsDraft(draft: SettingsDraft, edit: SettingsEdit): SettingsDraft {
  const settings = draft.values;
  const configuration = settings.configuration;
  switch (edit.type) {
    case 'add-connection': {
      if ((settings.profiles?.length ?? 0) >= 32)
        throw new Error('Keep at most 32 API connections.');
      return {
        ...draft,
        values: {
          ...settings,
          profiles: [
            ...(settings.profiles ?? []),
            {
              id: edit.id,
              name: nextName('New connection', settings.profiles ?? []),
              config: { ...DEFAULT_CONFIGURATION.openaiCompatible },
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
        values: next,
      };
    }
    case 'plan-account':
      return {
        ...draft,
        values: {
          ...settings,
          planAccountId: edit.accountId,
        },
      };
    case 'connection': {
      const profile = settings.profiles?.find((p) => p.id === edit.id);
      if (!profile) throw new Error('Choose an existing connection.');
      const config = { ...profile.config, ...edit.patch };
      if (!officialOpenAI(config.baseUrl)) delete config.credentialOwner;
      if (origin(config.baseUrl) !== origin(profile.config.baseUrl)) {
        config.apiKey = '';
        delete config.credentialOwner;
      }
      return {
        ...draft,
        values: {
          ...settings,
          profiles: settings.profiles?.map((p) =>
            p.id === profile.id
              ? { ...p, config, ...(edit.name === undefined ? {} : { name: edit.name }) }
              : p,
          ),
        },
      };
    }
    case 'connection-profile': {
      if (!settings.profiles?.some((p) => p.id === edit.profileId))
        throw new Error('Choose an existing connection.');
      return {
        ...draft,
        values: {
          ...settings,
          connectionProfiles: { ...settings.connectionProfiles, [edit.key]: edit.profileId },
        },
      };
    }
    case 'preset': {
      const preset = configuration.presets.find((p) => p.id === draft.presetId);
      if (!preset) throw new Error('Choose an existing preset.');
      const updated = { ...preset, ...edit.patch };
      if (edit.patch.capability === 'draw' && preset.capability !== 'draw')
        Object.assign(updated, {
          model: edit.patch.model ?? '',
          effort: '',
          fast: false,
          imageOptions: { size: '1024x1024', quality: 'low', outputFormat: 'png' },
        });
      if (edit.patch.capability === 'speak' && preset.capability !== 'speak')
        Object.assign(updated, {
          model: edit.patch.model ?? '',
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
      return { ...draft, values: next };
    }
    case 'connection-name':
      return {
        ...draft,
        values: {
          ...settings,
          connections: settings.connections.map((connection) =>
            connection.key === edit.key ? { ...connection, name: edit.name } : connection,
          ),
        },
      };
    case 'preset-connection': {
      const connection = settings.connections.find((item) => item.key === edit.key);
      const preset = configuration.presets.find((item) => item.id === draft.presetId);
      if (!connection || !preset) throw new Error('Choose an available connection.');
      const saved = settingsFromDraft(draft);
      const kind = connection.kind === 'chatgpt-plan' ? 'chatgpt-plan' : 'openai-compatible';
      const choices =
        preset.provider === kind
          ? preset
          : presetFromSelection(
              { ...inspectDraftPreset(draft), provider: kind },
              preset.id,
              preset.name,
            );
      const updated = {
        ...preset,
        model: choices.model,
        effort: choices.effort,
        fast: choices.fast,
        temperature: choices.temperature,
        topK: choices.topK,
        shared: draft.retained.sharedPresetRevision !== undefined,
        connectionKey: connection.key,
        provider:
          connection.kind === 'chatgpt-plan'
            ? ('chatgpt-plan' as const)
            : ('openai-compatible' as const),
        profileId:
          connection.kind === 'openai-api'
            ? settings.connectionProfiles?.[connection.key] ||
              (saved.openaiCompatible.baseUrl.replace(/\/+$/, '') === 'https://api.openai.com/v1'
                ? saved.activeProfileId
                : undefined) ||
              connection.key
            : undefined,
      };
      const configured = {
        ...settings,
        configuration: {
          ...configuration,
          presets: configuration.presets.map((item) => (item.id === preset.id ? updated : item)),
        },
      };
      return { ...draft, values: configured };
    }
    case 'settings':
      return { ...draft, values: { ...settings, ...edit.patch } };
    case 'preset-local-provider': {
      const preset = configuration.presets.find((p) => p.id === draft.presetId);
      if (!preset) throw new Error('Choose an existing preset.');
      const choices = presetFromSelection(
        { ...inspectDraftPreset(draft), provider: edit.provider },
        preset.id,
        preset.name,
      );
      const updated = {
        ...preset,
        ...choices,
        connectionKey: undefined,
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
      return { ...draft, values: next };
    }
    case 'select-preset': {
      const preset = configuration.presets.find((item) => item.id === edit.id);
      if (!preset) throw new Error('Choose an existing preset.');
      return {
        ...draft,
        presetId: preset.id,
      };
    }
    case 'add-preset':
      if (configuration.presets.length >= 32) throw new Error('Keep at most 32 presets.');
      return {
        ...draft,
        presetId: edit.id,
        values: {
          ...settings,
          configuration: {
            ...configuration,
            presets: [
              ...configuration.presets,
              presetFromSelection(
                inspectDraftPreset(draft),
                edit.id,
                nextName('New preset', configuration.presets),
              ),
            ],
          },
        },
      };
    case 'preset-name':
      return {
        ...draft,
        values: {
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
        values: { ...settings, configuration: { ...configuration, presets } },
      };
    }
    case 'select-recipe':
      if (!configuration.recipes.some((recipe) => recipe.id === edit.id))
        throw new Error('Choose an existing action.');
      return { ...draft, recipeId: edit.id };
    case 'add-illustrate': {
      if (configuration.recipes.some((r) => r.id === 'recipe-illustrate')) return draft;
      if (configuration.recipes.length >= 32 || configuration.presets.length >= 128)
        throw new Error('Remove an action or preset before adding Illustrate.');
      const draw = configuration.presets.find((p) => p.capability === 'draw');
      const preset = draw ?? illustrationPreset(settingsFromDraft(draft));
      return {
        ...draft,
        recipeId: 'recipe-illustrate',
        values: {
          ...settings,
          configuration: {
            ...configuration,
            presets: draw
              ? configuration.presets
              : [
                  ...configuration.presets,
                  { ...preset, name: nextName(preset.name, configuration.presets) },
                ],
            recipes: [
              ...configuration.recipes,
              {
                ...illustrationRecipe(),
                name: nextName('Illustrate', configuration.recipes),
                presetId: preset.id,
              },
            ],
          },
        },
      };
    }
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
        values: {
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
        values: {
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
        values: { ...settings, configuration: { ...configuration, selectedRecipeId: edit.id } },
      };
    case 'remove-recipe':
      if (draft.recipeId === configuration.selectedRecipeId)
        throw new Error('Choose another default action before removing this one.');
      return {
        ...draft,
        recipeId: configuration.selectedRecipeId,
        values: {
          ...settings,
          configuration: {
            ...configuration,
            recipes: configuration.recipes.filter((recipe) => recipe.id !== draft.recipeId),
          },
        },
      };
  }
}

export function settingsForSave(draft: SettingsDraft): Configuration {
  const settings = settingsFromDraft(draft);
  validateConfiguration(configurationFor(settings), settings.sharedPresetRevision !== undefined);
  validateSettingsConnections(settings);
  if (settings.connections) validateConnections(settings.connections);
  return structuredClone(settings);
}
