import { preparePreset } from '../src/configuration/resolve';
import { afterEach, expect, it, vi } from 'vitest';
import type { ResolvedContext } from '../src/types';
import type { Configuration } from '../src/configuration/definition';
import { DEFAULT_CONFIGURATION } from '../src/configuration/definition';
import { decodeConfiguration } from '../src/configuration/record';
import { inspectPreset } from '../src/configuration/inspect';
import { DEFAULT_SYSTEM_PROMPT } from '../src/reading/prompts';
import {
  configurationFor,
  normalizeConfiguration,
  parseTemplate,
  renderRecipePrompt,
  starterConfiguration,
  validateConfiguration,
} from '../src/configuration/definition';
import {
  prepareFollowUpRun,
  prepareFrozenRun,
  prepareRecipeRun,
} from '../src/reading/configuration';

const context: ResolvedContext = {
  selection: 'Gradient descent',
  paragraph: 'A surrounding paragraph.',
  heading: 'Learning',
  pageTitle: 'Calculus',
  pageUrl: 'https://example.test/article',
};
function configured(): Configuration {
  const settings = structuredClone(DEFAULT_CONFIGURATION);
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

it('follow-ups retain source, model and earlier exchanges without changing the saved request', () => {
  const settings = configured();
  const original = prepareRecipeRun(
    settings,
    context,
    settings.configuration!.selectedRecipeId,
  ).input;
  const before = structuredClone(original);
  const first = prepareFollowUpRun(
    settings,
    original,
    'First answer',
    'Why does that happen?',
  ).input;
  const second = prepareFollowUpRun(
    settings,
    first,
    'Second answer',
    'Give a concrete example.',
  ).input;
  expect(second.context).toEqual(original.context);
  expect(second.remote).toEqual(original.remote);
  expect(second.preset).toEqual(original.preset);
  expect(second.userPrompt).toContain(original.userPrompt);
  for (const text of [
    'First answer',
    'Why does that happen?',
    'Second answer',
    'Give a concrete example.',
  ])
    expect(second.userPrompt).toContain(text);
  expect(second.followUpQuestion).toBe('Give a concrete example.');
  expect(original).toEqual(before);
  for (const question of ['  ', 'x'.repeat(2001)])
    expect(() => prepareFollowUpRun(settings, original, 'Answer', question)).toThrow('2,000');
  expect(() => prepareFollowUpRun(settings, original, '', 'Why?')).toThrow('completed answer');
  expect(() =>
    prepareFollowUpRun(settings, { ...original, userPrompt: 'x'.repeat(120000) }, 'Answer', 'Why?'),
  ).toThrow('too long');
});

it('rejects records without an explicit configuration instead of inventing actions', () => {
  const stored = configured();
  delete stored.configuration;
  expect(() => decodeConfiguration(stored)).toThrow('configuration is missing');
});

it('uses the default system prompt when creating a new configuration with an empty prompt', () => {
  const settings = { ...configured(), customPromptTemplate: '' };
  const recipe = starterConfiguration(settings).recipes[0]!;
  expect(recipe.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
});

it('renders each named task as instructions instead of quoted source and adds no hidden Explain suffix', () => {
  const settings = configured();
  for (const recipe of configurationFor(settings)
    .recipes.slice(1)
    .filter((r) => r.capability !== 'draw')) {
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
    'default action',
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
  expect(() => prepareRecipeRun(settings, context, 'deleted')).toThrow('action no longer exists');
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
  const followup = prepareFollowUpRun(settings, original, 'Saved answer', 'Give an example');
  expect(followup.input.userPrompt).toContain(original.userPrompt);
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
  expect(() => prepareFrozenRun(settings, original)).toThrow('Select a new preset');
  settings.profiles = [];
  expect(() => prepareFrozenRun(settings, original)).toThrow('saved connection');
});

it('a plan preset uses its bound shared account and freezes it for retries', () => {
  const settings = configured();
  settings.configuration!.presets[0] = {
    id: 'preset-current',
    name: 'Plan',
    provider: 'chatgpt-plan',
    connectionKey: 'gpt-plan',
    model: 'plan-model',
    effort: 'high',
    fast: true,
  };
  settings.sharedCredentials = 'saul';
  settings.connections = [
    { key: 'gpt-plan', name: 'Shared', kind: 'chatgpt-plan', accountId: 'selected-account' },
  ];
  settings.chatgptPlan = { accountId: 'legacy-account', model: 'other' };
  const prepared = prepareRecipeRun(settings, context, configurationFor(settings).selectedRecipeId);
  settings.chatgptPlan.accountId = 'next-account';
  expect(prepareFrozenRun(settings, prepared.input).input.plan?.accountId).toBe('selected-account');
  expect(prepared.input.provider).toBe('chatgpt-plan');
  expect(prepared.input.plan).toEqual({
    accountId: 'selected-account',
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
  const before = prepareRecipeRun(settings, context, recipeId, true).input;
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

it('blocks shared API options before transport rather than silently discarding them', () => {
  const settings = configured();
  const preset = configurationFor(settings).presets[0]!;
  for (const options of [{ effort: 'low' }, { fast: true }]) {
    const request = { ...preset, ...options, connectionKey: 'openai-api', shared: true };
    expect(() => preparePreset(settings, request)).toThrow('Run it in EZ');
    expect(inspectPreset(settings, request).provider).toBe('openai-compatible');
  }
});
