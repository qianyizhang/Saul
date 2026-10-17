import type {
  ModelPreset,
  ReadingConfiguration,
  Recipe,
  ResolvedContext,
  UserSettings,
} from '../types';
import { DEFAULT_SYSTEM_PROMPT, renderReadingContext } from './prompts';

export const EXPLAIN_RECIPE_ID = 'recipe-explain';
export const TEMPLATE_FIELDS = [
  'text',
  'context',
  'page title',
  'page url',
  'heading',
  'paragraph',
] as const;
type TemplateField = (typeof TEMPLATE_FIELDS)[number];
type Part = { text: string } | { field: TemplateField };

/** Literal substitutions only. Inserted page text is never parsed as a template. */
export function parseTemplate(source: string): { parts: Part[]; fields: TemplateField[] } {
  if (new TextEncoder().encode(source).length > 32768)
    throw new Error('Prompt template exceeds 32 KB.');
  if (source.includes('{%') || source.includes('%}'))
    throw new Error('Use {{field name}} only; template expressions are not supported.');
  const parts: Part[] = [];
  const fields: TemplateField[] = [];
  let rest = source;
  while (rest.includes('{{')) {
    const opening = rest.indexOf('{{');
    const literal = rest.slice(0, opening);
    if (literal.includes('}}')) throw new Error('Unmatched }} in prompt template.');
    parts.push({ text: literal });
    const closing = rest.indexOf('}}', opening + 2);
    if (closing < 0) throw new Error('Close each input field with }}.');
    const name = rest.slice(opening + 2, closing).trim();
    if (!(TEMPLATE_FIELDS as readonly string[]).includes(name))
      throw new Error(
        `Unknown field “${name}”. Use ${TEMPLATE_FIELDS.map((field) => `{{${field}}}`).join(', ')}.`,
      );
    const field = name as TemplateField;
    parts.push({ field });
    if (!fields.includes(field)) fields.push(field);
    rest = rest.slice(closing + 2);
  }
  if (rest.includes('}}')) throw new Error('Unmatched }} in prompt template.');
  parts.push({ text: rest });
  if (!fields.includes('text')) throw new Error('Include {{text}} for the selected text.');
  return { parts, fields };
}

export function renderRecipePrompt(
  recipe: Recipe,
  context: ResolvedContext,
  instruction?: string,
): string {
  const parsed = parseTemplate(recipe.template);
  const values: Record<TemplateField, string | undefined> = {
    text: context.selection,
    context: renderReadingContext(context),
    'page title': context.pageTitle,
    'page url': context.pageUrl,
    heading: context.heading,
    paragraph: context.paragraph,
  };
  for (const field of parsed.fields) {
    if (!values[field]?.trim())
      throw new Error(
        `“${recipe.name}” needs {{${field}}}, but it is not available from this selection and its enabled context.`,
      );
  }
  const selection = parsed.parts
    .map((part) => ('text' in part ? part.text : values[part.field]))
    .join('');
  // Keep existing context assembly byte-for-byte for migrated {{text}} recipes.
  // Context that a template already placed is not appended a second time.
  const remaining = parsed.fields.includes('context')
    ? { selection, pageTitle: '', pageUrl: '' }
    : {
        ...context,
        selection,
        ...(parsed.fields.includes('page title') ? { pageTitle: '' } : {}),
        ...(parsed.fields.includes('page url') ? { pageUrl: '' } : {}),
        ...(parsed.fields.includes('heading') ? { heading: undefined } : {}),
        ...(parsed.fields.includes('paragraph')
          ? { paragraph: undefined, surroundingText: undefined }
          : {}),
      };
  const surrounding = renderReadingContext(remaining);
  const parts = surrounding ? [surrounding, selection] : [selection];
  if (instruction) parts.push(`\nAdditional Instruction: ${instruction}`);
  return parts.join('\n');
}

export function presetFromSettings(settings: UserSettings, id: string, name: string): ModelPreset {
  switch (settings.activeProvider) {
    case 'chatgpt-plan':
      return {
        id,
        name,
        provider: 'chatgpt-plan',
        model: settings.chatgptPlan?.model || '',
        accountId: settings.chatgptPlan?.accountId || '',
        ...(settings.chatgptPlan?.effort === undefined
          ? {}
          : { effort: settings.chatgptPlan.effort }),
        ...(settings.chatgptPlan?.fast === undefined ? {} : { fast: settings.chatgptPlan.fast }),
      };
    case 'chrome-ai':
      return { id, name, provider: 'chrome-ai', model: 'gemini-nano', ...settings.chromeAi };
    case 'openai-compatible':
      return {
        id,
        name,
        provider: 'openai-compatible',
        model: settings.openaiCompatible.model,
        profileId: settings.activeProfileId || 'default',
        temperature: settings.openaiCompatible.temperature,
      };
  }
}

export const DEFAULT_RECIPE_SYSTEM_PROMPT =
  'You are Saul, a concise language assistant. Follow the requested task and answer directly. Use plain text; annotate useful concepts with <term note="A brief explanation">concept</term> when helpful. Do not nest term tags.';
export function starterConfiguration(settings: UserSettings): ReadingConfiguration {
  const preset = presetFromSettings(settings, 'preset-current', 'Current');
  return {
    schemaVersion: 1,
    selectedRecipeId: EXPLAIN_RECIPE_ID,
    presets: [preset],
    recipes: [
      {
        id: EXPLAIN_RECIPE_ID,
        name: 'Explain',
        presetId: preset.id,
        template: '\n--- Selected Text to Explain ---\n"{{text}}"',
        systemPrompt: settings.customPromptTemplate || DEFAULT_SYSTEM_PROMPT,
      },
      {
        id: 'recipe-lookup',
        name: 'Lookup',
        presetId: preset.id,
        template:
          'Define this word or phrase in context. Give the relevant meaning and one natural example.\n\n{{text}}',
        systemPrompt: DEFAULT_RECIPE_SYSTEM_PROMPT,
      },
      {
        id: 'recipe-nudge',
        name: 'Nudge',
        presetId: preset.id,
        template:
          'Improve this wording while preserving its meaning and voice. Put the revised text first, then briefly explain any changes.\n\n{{text}}',
        systemPrompt: DEFAULT_RECIPE_SYSTEM_PROMPT,
      },
    ],
  };
}

export function configurationFor(settings: UserSettings): ReadingConfiguration {
  return settings.configuration || starterConfiguration(settings);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string, max = 32768): string {
  if (typeof value !== 'string' || value.length > max)
    throw new Error(`${label} must be text of at most ${max} characters.`);
  return value;
}
function optionalText(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : string(value, label, 256);
}
function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`${label} must be a finite number.`);
  return value;
}
export function normalizeConfiguration(
  value: unknown,
  settings: UserSettings,
): ReadingConfiguration {
  if (value === undefined) return starterConfiguration(settings);
  const stored = record(value, 'Configuration');
  if (stored.schemaVersion !== 1)
    throw new Error('Unsupported configuration version. Original settings are preserved.');
  if (!Array.isArray(stored.presets) || !Array.isArray(stored.recipes))
    throw new Error('Presets and recipes must be lists.');
  const configuration: ReadingConfiguration = {
    schemaVersion: 1,
    selectedRecipeId: string(stored.selectedRecipeId, 'Default recipe ID', 128),
    presets: stored.presets.map((entry) => {
      const preset = record(entry, 'Preset');
      if (!['openai-compatible', 'chatgpt-plan', 'chrome-ai'].includes(String(preset.provider)))
        throw new Error('Preset provider is not supported.');
      if (preset.fast !== undefined && typeof preset.fast !== 'boolean')
        throw new Error('Preset Fast must be true or false.');
      return {
        id: string(preset.id, 'Preset ID', 128),
        name: string(preset.name, 'Preset name', 80),
        provider: preset.provider as ModelPreset['provider'],
        model: string(preset.model, 'Preset model', 256),
        profileId: optionalText(preset.profileId, 'Preset profile'),
        accountId: optionalText(preset.accountId, 'Preset account'),
        temperature: optionalNumber(preset.temperature, 'Preset temperature'),
        topK: optionalNumber(preset.topK, 'Preset top K'),
        effort: optionalText(preset.effort, 'Preset effort'),
        fast: preset.fast as boolean | undefined,
      };
    }),
    recipes: stored.recipes.map((entry) => {
      const recipe = record(entry, 'Recipe');
      return {
        id: string(recipe.id, 'Recipe ID', 128),
        name: string(recipe.name, 'Recipe name', 80),
        presetId: string(recipe.presetId, 'Default preset ID', 128),
        template: string(recipe.template, 'Prompt template'),
        systemPrompt: string(recipe.systemPrompt, 'System prompt'),
      };
    }),
  };
  validateConfiguration(configuration);
  return configuration;
}

export function validateConfiguration(configuration: ReadingConfiguration): void {
  if (configuration.schemaVersion !== 1) throw new Error('Unsupported configuration version.');
  for (const [label, items] of [
    ['presets', configuration.presets],
    ['recipes', configuration.recipes],
  ] as const) {
    if (!items.length || items.length > 32) throw new Error(`Keep between 1 and 32 ${label}.`);
    const names = items.map((item) => item.name.trim().toLocaleLowerCase());
    if (names.some((name) => !name) || new Set(names).size !== names.length)
      throw new Error(`Names must be nonempty and unique within ${label}.`);
    const ids = items.map((item) => item.id);
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length)
      throw new Error(`Duplicate or missing ${label} IDs.`);
  }
  if (!configuration.recipes.some((recipe) => recipe.id === configuration.selectedRecipeId))
    throw new Error('Choose an existing default recipe.');
  for (const recipe of configuration.recipes) {
    if (!configuration.presets.some((preset) => preset.id === recipe.presetId))
      throw new Error(`Recipe “${recipe.name}” needs an existing default preset.`);
    parseTemplate(recipe.template);
    if (new TextEncoder().encode(recipe.systemPrompt).length > 32768)
      throw new Error(`“${recipe.name}” system prompt exceeds 32 KB.`);
  }
}

export function settingsForPreset(
  settings: UserSettings,
  preset: ModelPreset,
  editing = false,
): UserSettings {
  if (preset.provider === 'openai-compatible') {
    const profile = settings.profiles?.find((profile) => profile.id === preset.profileId);
    const implicit =
      !settings.profiles && preset.profileId === (settings.activeProfileId || 'default');
    const source =
      profile?.config ||
      (implicit
        ? settings.openaiCompatible
        : editing
          ? {
              baseUrl: '',
              apiKey: '',
              model: preset.model,
              temperature: preset.temperature ?? 0.3,
            }
          : undefined);
    if (!source)
      throw new Error(
        `Preset “${preset.name}” needs its saved connection. Choose a connection in Settings.`,
      );
    return {
      ...settings,
      activeProvider: preset.provider,
      activeProfileId: preset.profileId,
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
        accountId: preset.accountId || '',
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
