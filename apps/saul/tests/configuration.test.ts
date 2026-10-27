import { afterEach, expect, it, vi } from 'vitest';
import type { ResolvedContext, UserSettings } from '../src/types';
import { DEFAULT_SETTINGS, getSettings } from '../src/storage/settings';
import { DEFAULT_SYSTEM_PROMPT, renderExplainPrompt } from '../src/models/prompts';
import {
  configurationFor,
  normalizeConfiguration,
  parseTemplate,
  renderRecipePrompt,
  starterConfiguration,
  validateConfiguration,
} from '../src/models/configuration';
import { prepareFrozenRun, prepareRecipeRun } from '../src/reading/configuration';

const context: ResolvedContext = {
  selection: 'Gradient descent',
  paragraph: 'A surrounding paragraph.',
  heading: 'Learning',
  pageTitle: 'Calculus',
  pageUrl: 'https://example.test/article',
};
function configured(): UserSettings {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.openaiCompatible = {
    baseUrl: 'https://example.test/v1',
    apiKey: 'private-key',
    model: 'chosen-model',
    temperature: 0.7,
  };
  settings.profiles = [
    { id: 'connection-a', name: 'Connection A', config: { ...settings.openaiCompatible } },
  ];
  settings.activeProfileId = 'connection-a';
  settings.customPromptTemplate = 'Keep this exact system prompt.\r\nNo rewriting.';
  settings.configuration = starterConfiguration(settings);
  return settings;
}
afterEach(() => vi.unstubAllGlobals());

it('migrates the legacy system prompt, model and context assembly without writing over saved data', async () => {
  const legacy = configured();
  delete legacy.configuration;
  const set = vi.fn();
  vi.stubGlobal('chrome', {
    storage: { local: { get: vi.fn().mockResolvedValue({ saul_user_settings: legacy }), set } },
  });
  const settings = await getSettings();
  const configuration = configurationFor(settings);
  expect(configuration.recipes.map((recipe) => recipe.name)).toEqual([
    'Explain',
    'Lookup',
    'Nudge',
  ]);
  expect(configuration.recipes[0]!.systemPrompt).toBe(legacy.customPromptTemplate);
  expect(configuration.presets[0]).toMatchObject({
    name: 'Current',
    model: 'chosen-model',
    profileId: 'connection-a',
    temperature: 0.7,
  });
  const prepared = prepareRecipeRun(settings, context, configuration.selectedRecipeId);
  expect(prepared.input.userPrompt).toBe(
    renderExplainPrompt(context, 'Respond in the language of the selected text.'),
  );
  expect(prepared.input.systemPrompt).toBe(legacy.customPromptTemplate);
  expect(prepared.credential).toBe('private-key');
  expect(JSON.stringify(prepared.input)).not.toContain('private-key');
  expect(set).not.toHaveBeenCalled();
});

it('migrates an empty legacy system prompt with its original default behavior', () => {
  const settings = { ...configured(), customPromptTemplate: '' };
  const recipe = starterConfiguration(settings).recipes[0]!;
  expect(recipe.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
});

it('preserves the authoritative legacy current endpoint and key when its saved profile differs', async () => {
  const legacy = configured();
  delete legacy.configuration;
  legacy.profiles![0]!.config = {
    ...legacy.openaiCompatible,
    baseUrl: 'https://stale.test/v1',
    apiKey: 'stale-key',
  };
  vi.stubGlobal('chrome', {
    storage: { local: { get: vi.fn().mockResolvedValue({ saul_user_settings: legacy }) } },
  });
  const settings = await getSettings();
  const prepared = prepareRecipeRun(settings, context, configurationFor(settings).selectedRecipeId);
  expect(prepared.input.remote.baseUrl).toBe('https://example.test/v1');
  expect(prepared.credential).toBe('private-key');
  expect(settings.profiles?.find((profile) => profile.id === 'connection-a')?.config.apiKey).toBe(
    'stale-key',
  );
});

it('renders each named task as instructions instead of quoted source and adds no hidden Explain suffix', () => {
  const settings = configured();
  for (const recipe of configurationFor(settings).recipes.slice(1)) {
    const prompt = renderRecipePrompt(recipe, context);
    expect(prompt).toContain(
      recipe.name === 'Lookup' ? 'Define this word or phrase' : 'Improve this wording',
    );
    expect(prompt).not.toContain('--- Selected Text to Explain ---');
    expect(prompt).not.toContain('Please explain this concept');
  }
});

it('substitutes literal bounded fields once and never repeats explicitly placed context', () => {
  const recipe = {
    ...configurationFor(configured()).recipes[0]!,
    template: 'Task: {{text}}\nContext: {{context}}',
  };
  const prompt = renderRecipePrompt(recipe, {
    ...context,
    selection: '{{heading}} should stay literal',
  });
  expect(prompt).toContain('Task: {{heading}} should stay literal');
  expect(prompt.match(/A surrounding paragraph\./g)).toHaveLength(1);
  expect(prompt.match(/https:\/\/example.test\/article/g)).toHaveLength(1);
  const explicit = renderRecipePrompt({ ...recipe, template: '{{text}}\n{{paragraph}}' }, context);
  expect(explicit.match(/A surrounding paragraph\./g)).toHaveLength(1);
});

it('rejects unsupported expressions and unavailable source fields instead of filling them silently', () => {
  for (const template of [
    'No input',
    '{{unknown}} {{text}}',
    '{{text.toUpperCase()}}',
    '{% if text %}{{text}}',
    '{{text',
  ])
    expect(() => parseTemplate(template)).toThrow();
  const recipe = {
    ...configurationFor(configured()).recipes[0]!,
    template: '{{text}}\n{{heading}}',
  };
  expect(() => renderRecipePrompt(recipe, { ...context, heading: undefined })).toThrow(
    'needs {{heading}}',
  );
});

it('rejects missing and duplicate configuration references without silently changing choices', () => {
  const settings = configured();
  const configuration = configurationFor(settings);
  expect(() => normalizeConfiguration({ ...configuration, schemaVersion: 2 }, settings)).toThrow(
    'Unsupported configuration',
  );
  expect(() => validateConfiguration({ ...configuration, selectedRecipeId: 'missing' })).toThrow(
    'default recipe',
  );
  expect(() =>
    validateConfiguration({
      ...configuration,
      recipes: [{ ...configuration.recipes[0]!, presetId: 'missing' }],
    }),
  ).toThrow('default preset');
  expect(() =>
    validateConfiguration({
      ...configuration,
      recipes: [
        configuration.recipes[0]!,
        { ...configuration.recipes[0]!, id: 'other', name: ' explain ' },
      ],
    }),
  ).toThrow('unique');
  expect(() => prepareRecipeRun(settings, context, 'deleted')).toThrow('recipe no longer exists');
  expect(() =>
    prepareRecipeRun({ ...settings, profiles: [] }, context, configuration.selectedRecipeId),
  ).toThrow('saved connection');
});

it('freezes request inputs and retries them exactly after recipe, preset, language and active-provider edits', () => {
  const settings = configured();
  const original = prepareRecipeRun(
    settings,
    context,
    configurationFor(settings).selectedRecipeId,
  ).input;
  const expected = structuredClone(original);
  settings.configuration!.recipes[0]!.template = 'Changed task {{text}}';
  settings.configuration!.recipes[0]!.systemPrompt = 'Changed system prompt';
  settings.configuration!.presets[0]!.model = 'changed-model';
  settings.activeProvider = 'chatgpt-plan';
  settings.chatgptPlan = {
    accountId: 'different-account',
    model: 'other-model',
    effort: 'high',
    fast: true,
  };
  settings.responseLanguage = 'Chinese';
  settings.profiles![0]!.config.apiKey = 'rotated-key';
  const retry = prepareFrozenRun(settings, original);
  expect(retry.input).toEqual(expected);
  expect(retry.credential).toBe('rotated-key');
  expect(original).toEqual(expected);
  expect(retry.input).not.toBe(original);
  const followup = prepareFrozenRun(settings, original, 'Give an example');
  expect(followup.input.userPrompt).toBe(
    original.userPrompt + '\n\nAdditional Instruction: Give an example',
  );
  expect(followup.input.recipe).toEqual(expected.recipe);
});

it('does not send a frozen request with credentials for an edited endpoint or removed connection', () => {
  const settings = configured();
  const original = prepareRecipeRun(
    settings,
    context,
    configurationFor(settings).selectedRecipeId,
  ).input;
  settings.profiles![0]!.config.baseUrl = 'https://different.test/v1';
  expect(() => prepareFrozenRun(settings, original)).toThrow('endpoint has changed');
  settings.profiles = [];
  expect(() => prepareFrozenRun(settings, original)).toThrow('saved connection');
});

it('a recipe explicitly selects its ChatGPT account, model, effort and speed independently of active provider', () => {
  const settings = configured();
  settings.configuration!.presets[0] = {
    id: 'preset-current',
    name: 'Plan',
    provider: 'chatgpt-plan',
    accountId: 'saved-account',
    model: 'plan-model',
    effort: 'high',
    fast: true,
  };
  const prepared = prepareRecipeRun(settings, context, configurationFor(settings).selectedRecipeId);
  expect(prepared.input.provider).toBe('chatgpt-plan');
  expect(prepared.input.plan).toEqual({
    accountId: 'saved-account',
    model: 'plan-model',
    effort: 'high',
    fast: true,
  });
  expect(prepared.credential).toBe('');
});

it('reviews current input without requiring a credential, while generation still validates it', async () => {
  const settings = configured();
  settings.openaiCompatible.apiKey = '';
  settings.profiles![0]!.config.apiKey = '';
  const recipeId = configurationFor(settings).selectedRecipeId;
  expect(() => prepareRecipeRun(settings, context, recipeId)).toThrow();
  const before = prepareRecipeRun(settings, context, recipeId, undefined, true).input;
  const after = structuredClone(before);
  after.systemPrompt += '\nChanged instructions';
  after.userPrompt += '\nA new finding';
  after.remote.model = 'another-model';
  const { compareRunInput } = await import('../src/reading/input-change');
  expect(compareRunInput(before, after)).toMatchObject({
    text: { kind: 'changed', added: 3 },
    fields: ['Instructions', 'Model settings'],
  });
});
