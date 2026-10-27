import type { Recipe, UserSettings } from '../types';
import { DEFAULT_SETTINGS, validateProviderSettings } from '../storage/settings';
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
  | { type: 'remote'; patch: Partial<UserSettings['openaiCompatible']> }
  | { type: 'select-profile'; id: string }
  | { type: 'add-profile'; id: string }
  | { type: 'profile-name'; name: string }
  | { type: 'select-preset'; id: string }
  | { type: 'add-preset'; id: string }
  | { type: 'preset-name'; name: string }
  | { type: 'remove-preset' }
  | { type: 'select-recipe'; id: string }
  | { type: 'add-recipe'; id: string }
  | { type: 'recipe'; patch: Partial<Recipe> }
  | { type: 'default-recipe'; id: string }
  | { type: 'remove-recipe' };

function withCurrentProfile(settings: UserSettings): UserSettings {
  return {
    ...settings,
    profiles: settings.profiles?.map((profile) =>
      profile.id === settings.activeProfileId
        ? { ...profile, config: { ...settings.openaiCompatible } }
        : profile,
    ),
  };
}

function updateChoices(draft: SettingsDraft, patch: Partial<UserSettings>): SettingsDraft {
  const settings = { ...draft.settings, ...patch };
  const configuration = configurationFor(settings);
  return {
    ...draft,
    settings: withCurrentProfile({
      ...settings,
      configuration: {
        ...configuration,
        presets: configuration.presets.map((preset) =>
          preset.id === draft.presetId
            ? presetFromSettings(settings, preset.id, preset.name)
            : preset,
        ),
      },
    }),
  };
}

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

/** Views supply edits; the module owns mirrored choices, references and key clearing. */
export function editSettingsDraft(draft: SettingsDraft, edit: SettingsEdit): SettingsDraft {
  const settings = draft.settings;
  const configuration = configurationFor(settings);
  switch (edit.type) {
    case 'settings':
      return updateChoices(draft, edit.patch);
    case 'remote': {
      const remote = { ...settings.openaiCompatible, ...edit.patch };
      if (origin(remote.baseUrl) !== origin(settings.openaiCompatible.baseUrl)) remote.apiKey = '';
      return updateChoices(draft, { openaiCompatible: remote });
    }
    case 'profile-name':
      return updateChoices(draft, {
        profiles: settings.profiles?.map((profile) =>
          profile.id === settings.activeProfileId ? { ...profile, name: edit.name } : profile,
        ),
      });
    case 'select-profile': {
      const current = withCurrentProfile(settings);
      const profile = current.profiles?.find((item) => item.id === edit.id);
      if (!profile) throw new Error('Choose an existing profile.');
      return updateChoices(draft, {
        profiles: current.profiles,
        activeProfileId: profile.id,
        openaiCompatible: { ...profile.config },
      });
    }
    case 'add-profile': {
      const current = withCurrentProfile(settings);
      const profile = {
        id: edit.id,
        name: `Profile ${(current.profiles?.length || 0) + 1}`,
        config: { ...DEFAULT_SETTINGS.openaiCompatible, apiKey: '' },
      };
      return updateChoices(draft, {
        profiles: [...(current.profiles || []), profile],
        activeProfileId: profile.id,
        openaiCompatible: profile.config,
      });
    }
    case 'select-preset': {
      const preset = configuration.presets.find((item) => item.id === edit.id);
      if (!preset) throw new Error('Choose an existing preset.');
      return {
        ...draft,
        settings: settingsForPreset(withCurrentProfile(settings), preset, true),
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
      return updateChoices(draft, {
        configuration: {
          ...configuration,
          presets: configuration.presets.map((item) =>
            item.id === draft.presetId ? { ...item, name: edit.name } : item,
          ),
        },
      });
    case 'remove-preset': {
      const used = configuration.recipes.filter((recipe) => recipe.presetId === draft.presetId);
      if (used.length)
        throw new Error(
          `This preset is used by ${used.map((recipe) => recipe.name).join(', ')}. Choose another default preset for those recipes first.`,
        );
      const presets = configuration.presets.filter((preset) => preset.id !== draft.presetId);
      if (!presets.length) throw new Error('Keep at least one preset.');
      return {
        ...draft,
        presetId: presets[0]!.id,
        settings: settingsForPreset(
          { ...withCurrentProfile(settings), configuration: { ...configuration, presets } },
          presets[0]!,
          true,
        ),
      };
    }
    case 'select-recipe':
      if (!configuration.recipes.some((recipe) => recipe.id === edit.id))
        throw new Error('Choose an existing recipe.');
      return { ...draft, recipeId: edit.id };
    case 'add-recipe':
      if (configuration.recipes.length >= 32) throw new Error('Keep at most 32 recipes.');
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
                name: nextName('New recipe', configuration.recipes),
                presetId: draft.presetId,
                template: '{{text}}',
                systemPrompt: DEFAULT_RECIPE_SYSTEM_PROMPT,
              },
            ],
          },
        },
      };
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
        throw new Error('Choose an existing default recipe.');
      return {
        ...draft,
        settings: { ...settings, configuration: { ...configuration, selectedRecipeId: edit.id } },
      };
    case 'remove-recipe':
      if (draft.recipeId === configuration.selectedRecipeId)
        throw new Error('Choose another default recipe before removing this one.');
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
  const settings = withCurrentProfile(draft.settings);
  validateConfiguration(configurationFor(settings), settings.sharedPresetRevision !== undefined);
  validateProviderSettings(settings);
  return structuredClone(settings);
}
