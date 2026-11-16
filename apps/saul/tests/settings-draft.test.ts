import { expect, it } from 'vitest';
import {
  createSettingsDraft,
  editSettingsDraft,
  settingsForSave,
  settingsFromDraft,
  settingsForInspection,
} from '../src/models/settings-draft';
import { DEFAULT_SETTINGS } from '../src/storage/settings';
import { configurationFor } from '../src/models/configuration';
import type { UserSettings } from '../src/types';

function savedChoices(): UserSettings {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.activeProfileId = 'default';
  settings.openaiCompatible.model = 'saved-api-model';
  settings.profiles = [
    { id: 'default', name: 'Default', config: { ...settings.openaiCompatible } },
    {
      id: 'other',
      name: 'Other',
      config: {
        ...settings.openaiCompatible,
        baseUrl: 'https://other.example.test/v1',
        apiKey: 'fixture-key',
      },
    },
  ];
  settings.chatgptPlan = { accountId: 'local-A', model: 'saved-plan-model' };
  settings.connections.push({
    key: 'plan-b',
    name: 'Plan B',
    kind: 'chatgpt-plan',
    accountId: 'bound-B',
  });
  settings.configuration!.presets.push(
    {
      id: 'other',
      name: 'Other',
      provider: 'openai-compatible',
      profileId: 'other',
      model: 'other-model',
      temperature: 0.8,
    },
    {
      id: 'plan-b',
      name: 'Plan B',
      provider: 'chatgpt-plan',
      connectionKey: 'plan-b',
      model: 'plan-model',
      effort: 'high',
      fast: true,
    },
    {
      id: 'speech',
      name: 'Speech',
      provider: 'openai-compatible',
      connectionKey: 'openai-api',
      capability: 'speak',
      model: 'speech-model',
      speechOptions: { voice: 'cedar' },
    },
    {
      id: 'retired',
      name: 'Retired',
      provider: 'chrome-ai',
      model: 'gemini-nano',
      temperature: 0.7,
      topK: 6,
    },
  );
  return settings;
}

it.each(['other', 'plan-b', 'speech', 'preset-illustration', 'retired'])(
  'inspecting %s leaves all owned values and the save payload unchanged',
  (id) => {
    const original = createSettingsDraft(savedChoices());
    const selected = editSettingsDraft(original, { type: 'select-preset', id });
    expect(selected.presetId).toBe(id);
    expect(selected.values).toBe(original.values);
    expect(settingsForSave(selected)).toEqual(settingsForSave(original));
    const edited = editSettingsDraft(selected, {
      type: 'settings',
      patch: { responseLanguage: 'Chinese' },
    });
    expect(settingsForSave(edited)).toEqual({
      ...settingsForSave(original),
      responseLanguage: 'Chinese',
    });
  },
);

it('derives the inspected route without replacing the standalone account or saved provider', () => {
  let draft = createSettingsDraft(savedChoices());
  draft = editSettingsDraft(draft, { type: 'select-preset', id: 'plan-b' });
  expect(settingsForInspection(draft).chatgptPlan).toEqual({
    accountId: 'bound-B',
    model: 'plan-model',
    effort: 'high',
    fast: true,
  });
  draft = editSettingsDraft(draft, { type: 'plan-account', accountId: 'explicit-C' });
  draft = editSettingsDraft(draft, { type: 'preset', patch: { model: 'edited-plan-model' } });
  expect(settingsForSave(draft).chatgptPlan).toEqual({
    accountId: 'explicit-C',
    model: 'saved-plan-model',
  });
  expect(settingsForInspection(draft).chatgptPlan?.accountId).toBe('bound-B');
  draft = editSettingsDraft(draft, { type: 'select-preset', id: 'other' });
  expect(settingsForInspection(draft).openaiCompatible).toMatchObject({
    baseUrl: 'https://other.example.test/v1',
    model: 'other-model',
    temperature: 0.8,
  });
  expect(settingsForSave(draft).activeProfileId).toBe('default');
});

it('updates only an explicitly edited active profile route at the transport boundary', () => {
  const source = savedChoices();
  // Valid older records can disagree with the active profile; inspection must not repair them.
  source.openaiCompatible.baseUrl = 'https://retained.example.test/v1';
  source.openaiCompatible.apiKey = 'retained-key';
  const original = createSettingsDraft(source);
  let draft = editSettingsDraft(original, { type: 'select-preset', id: 'other' });
  expect(settingsForSave(draft).openaiCompatible).toEqual(source.openaiCompatible);
  draft = editSettingsDraft(draft, {
    type: 'connection',
    id: 'other',
    patch: { apiKey: 'other-new-key' },
  });
  expect(settingsForSave(draft).openaiCompatible).toEqual(source.openaiCompatible);
  draft = editSettingsDraft(draft, {
    type: 'connection',
    id: 'default',
    patch: { baseUrl: 'https://new.example.test/v1' },
  });
  expect(settingsForSave(draft).openaiCompatible).toEqual({
    ...source.openaiCompatible,
    baseUrl: 'https://new.example.test/v1',
    apiKey: '',
    credentialOwner: undefined,
  });
  expect(settingsForSave(original).openaiCompatible).toEqual(source.openaiCompatible);
  expect(settingsForInspection(draft).openaiCompatible.apiKey).toBe('other-new-key');
});

it('keeps managed inspection and unavailable profile edits out of saved defaults', () => {
  const source = savedChoices();
  source.sharedCredentials = 'saul';
  source.connections[1]!.baseUrl = 'https://api.openai.com/v1';
  source.configuration!.presets.push({
    id: 'managed',
    name: 'Managed',
    provider: 'openai-compatible',
    connectionKey: 'openai-api',
    model: 'managed-model',
  });
  let draft = editSettingsDraft(createSettingsDraft(source), {
    type: 'select-preset',
    id: 'managed',
  });
  expect(settingsForInspection(draft).openaiCompatible).toMatchObject({
    apiKey: '',
    credentialOwner: 'saul',
    model: 'managed-model',
  });
  expect(settingsForSave(draft).openaiCompatible).toEqual(source.openaiCompatible);
  draft = { ...draft, values: { ...draft.values, profiles: [] } };
  draft = editSettingsDraft(draft, { type: 'select-preset', id: 'other' });
  expect(settingsForInspection(draft).openaiCompatible.baseUrl).toBe('');
  expect(draft.values.configuration.presets.find((p) => p.id === 'other')?.profileId).toBe('other');
});

it('retains editor IDs after save and shared ID remapping while keeping the saved default', () => {
  let draft = editSettingsDraft(createSettingsDraft(savedChoices()), {
    type: 'select-preset',
    id: 'plan-b',
  });
  draft = editSettingsDraft(draft, { type: 'select-recipe', id: 'recipe-lookup' });
  const saved = settingsForSave(draft);
  saved.configuration!.presets.find((p) => p.id === 'plan-b')!.id = 'remapped-plan';
  const received = createSettingsDraft(saved, draft);
  expect(received.presetId).toBe('remapped-plan');
  expect(received.recipeId).toBe('recipe-lookup');
  expect(received.values.configuration.selectedRecipeId).toBe('recipe-explain');
  expect(settingsForSave(received).chatgptPlan?.accountId).toBe('local-A');
});

it('seeds a new Write preset from the inspected values without changing saved defaults', () => {
  let draft = editSettingsDraft(createSettingsDraft(savedChoices()), {
    type: 'select-preset',
    id: 'other',
  });
  draft = editSettingsDraft(draft, { type: 'add-preset', id: 'new' });
  expect(draft.values.configuration.presets.at(-1)).toMatchObject({
    provider: 'openai-compatible',
    model: 'other-model',
    profileId: 'other',
    temperature: 0.8,
  });
  draft = editSettingsDraft(draft, { type: 'preset-connection', key: 'gpt-plan' });
  expect(draft.values.configuration.presets.at(-1)?.model).toBe('saved-plan-model');
  expect(settingsForSave(draft).openaiCompatible.model).toBe('saved-api-model');
});

it('keeps connection credentials separate when switching presets and connections', () => {
  let draft = createSettingsDraft(DEFAULT_SETTINGS);
  draft = editSettingsDraft(draft, {
    type: 'connection',
    id: 'default',
    patch: { apiKey: 'first-key' },
  });
  draft = editSettingsDraft(draft, { type: 'preset', patch: { model: 'first-model' } });
  draft = editSettingsDraft(draft, { type: 'add-connection', id: 'second' });
  draft = editSettingsDraft(draft, {
    type: 'connection',
    id: 'second',
    patch: { apiKey: 'second-key' },
  });
  draft = editSettingsDraft(draft, { type: 'add-preset', id: 'another' });
  draft = editSettingsDraft(draft, { type: 'preset-profile', id: 'second' });
  draft = editSettingsDraft(draft, { type: 'preset', patch: { model: 'second-model' } });
  draft = editSettingsDraft(draft, { type: 'select-preset', id: 'preset-current' });
  expect(settingsForInspection(draft).openaiCompatible).toMatchObject({
    apiKey: 'first-key',
    model: 'first-model',
  });
  draft = editSettingsDraft(draft, { type: 'select-preset', id: 'another' });
  expect(settingsForInspection(draft).openaiCompatible).toMatchObject({
    apiKey: 'second-key',
    model: 'second-model',
  });
  expect(settingsForSave(draft).profiles).toHaveLength(2);
});

it('clears credentials on origin changes while retaining same-origin path edits', () => {
  let draft = createSettingsDraft(DEFAULT_SETTINGS);
  draft = editSettingsDraft(draft, {
    type: 'connection',
    id: 'default',
    patch: { apiKey: 'private' },
  });
  draft = editSettingsDraft(draft, {
    type: 'connection',
    id: 'default',
    patch: { baseUrl: 'https://api.openai.com/other' },
  });
  expect(settingsFromDraft(draft).profiles![0]!.config.apiKey).toBe('private');
  draft = editSettingsDraft(draft, {
    type: 'connection',
    id: 'default',
    patch: { baseUrl: 'https://example.test/v1' },
  });
  expect(settingsFromDraft(draft).profiles![0]!.config.apiKey).toBe('');
});

it('owns recipe/preset references and preserves editing selection across unrelated changes', () => {
  let draft = createSettingsDraft(DEFAULT_SETTINGS);
  expect(() => editSettingsDraft(draft, { type: 'remove-preset' })).toThrow('used by');
  draft = editSettingsDraft(draft, { type: 'add-preset', id: 'spare' });
  draft = editSettingsDraft(draft, { type: 'add-recipe', id: 'new' });
  expect(configurationFor(settingsFromDraft(draft)).recipes.at(-1)?.presetId).toBe('spare');
  draft = editSettingsDraft(draft, {
    type: 'recipe',
    patch: { name: 'Custom', template: 'Read {{text}}' },
  });
  draft = editSettingsDraft(draft, { type: 'settings', patch: { responseLanguage: 'Chinese' } });
  expect(draft.recipeId).toBe('new');
  expect(draft.presetId).toBe('spare');
  expect(() => editSettingsDraft(draft, { type: 'remove-preset' })).toThrow('Custom');
  draft = editSettingsDraft(draft, { type: 'remove-recipe' });
  draft = editSettingsDraft(draft, { type: 'remove-preset' });
  expect(draft.presetId).toBe('preset-current');
  expect(configurationFor(settingsForSave(draft)).recipes).toHaveLength(4);
});

it('keeps invalid edits in the draft until explicit validation succeeds', () => {
  let draft = createSettingsDraft(DEFAULT_SETTINGS);
  draft = editSettingsDraft(draft, { type: 'recipe', patch: { template: '{{text' } });
  expect(() => settingsForSave(draft)).toThrow('Close each input');
  expect(configurationFor(settingsFromDraft(draft)).recipes[0]?.template).toBe('{{text');
  expect(configurationFor(DEFAULT_SETTINGS).recipes[0]?.template).not.toBe('{{text');
});

it('preserves a shared Draw preset through unrelated settings and connection-name edits', () => {
  const source = structuredClone(DEFAULT_SETTINGS);
  source.sharedPresetRevision = 2;
  source.connections = [
    { key: 'gpt-plan', name: 'Plan', kind: 'chatgpt-plan' },
    { key: 'openai-api', name: 'API', kind: 'openai-api' },
  ];
  const image = {
    id: 'c14b29f3-3ec2-4efc-8bed-e05531aef2cb',
    name: 'Illustration',
    provider: 'openai-compatible' as const,
    connectionKey: 'openai-api',
    capability: 'draw' as const,
    shared: true,
    model: 'gpt-image-2.5-flare',
    effort: '',
    fast: false,
    imageOptions: { size: '1536x1024', quality: 'medium' },
  };
  source.configuration!.presets.push(image);
  let draft = createSettingsDraft(source);
  draft = editSettingsDraft(draft, { type: 'select-preset', id: image.id });
  draft = editSettingsDraft(draft, { type: 'settings', patch: { responseLanguage: 'Chinese' } });
  draft = editSettingsDraft(draft, { type: 'connection-name', key: 'openai-api', name: 'My API' });
  const saved = settingsForSave(draft);
  expect(saved.configuration!.presets.find((p) => p.id === image.id)).toEqual(image);
  expect(saved.connections?.[1]).toEqual({ key: 'openai-api', name: 'My API', kind: 'openai-api' });
});

it('edits provider connections without overwriting a selected Speak or Write preset', () => {
  let draft = createSettingsDraft(DEFAULT_SETTINGS);
  draft = editSettingsDraft(draft, { type: 'preset', patch: { model: 'write-choice' } });
  const write = structuredClone(configurationFor(settingsFromDraft(draft)).presets[0]);
  draft = editSettingsDraft(draft, {
    type: 'connection',
    id: 'default',
    patch: { apiKey: 'private', baseUrl: 'https://api.openai.com/v1' },
  });
  expect(configurationFor(settingsFromDraft(draft)).presets[0]).toEqual(write);
  draft = editSettingsDraft(draft, { type: 'add-preset', id: 'speak' });
  draft = editSettingsDraft(draft, { type: 'preset-connection', key: 'openai-api' });
  draft = editSettingsDraft(draft, { type: 'preset', patch: { capability: 'speak' } });
  draft = editSettingsDraft(draft, {
    type: 'preset',
    patch: { speechOptions: { voice: 'cedar' } },
  });
  const speech = structuredClone(configurationFor(settingsFromDraft(draft)).presets.at(-1));
  draft = editSettingsDraft(draft, { type: 'plan-account', accountId: 'explicit-account' });
  draft = editSettingsDraft(draft, {
    type: 'connection',
    id: 'default',
    patch: { baseUrl: 'https://example.test/v1' },
  });
  expect(configurationFor(settingsFromDraft(draft)).presets.at(-1)).toEqual(speech);
  expect(settingsFromDraft(draft).profiles![0]!.config.apiKey).toBe('');
  draft = editSettingsDraft(draft, { type: 'select-preset', id: 'preset-current' });
  expect(configurationFor(settingsForSave(draft)).presets.at(-1)).toEqual(speech);
});

it('keeps the chosen Write model when editing its connection, preferences and name', () => {
  let draft = createSettingsDraft(DEFAULT_SETTINGS);
  draft = editSettingsDraft(draft, { type: 'preset', patch: { model: 'chosen-model' } });
  draft = editSettingsDraft(draft, {
    type: 'connection',
    id: 'default',
    patch: { apiKey: 'fixture-key' },
  });
  draft = editSettingsDraft(draft, { type: 'settings', patch: { responseLanguage: 'Chinese' } });
  draft = editSettingsDraft(draft, { type: 'preset-name', name: 'Chosen' });
  expect(configurationFor(settingsForSave(draft)).presets[0]?.model).toBe('chosen-model');
});

it('gives a new reading action a Write preset when a Speak preset is being edited', () => {
  let draft = createSettingsDraft(DEFAULT_SETTINGS);
  const writing = draft.presetId;
  draft = editSettingsDraft(draft, { type: 'add-preset', id: 'speak' });
  draft = editSettingsDraft(draft, { type: 'preset-connection', key: 'openai-api' });
  draft = editSettingsDraft(draft, { type: 'preset', patch: { capability: 'speak' } });
  draft = editSettingsDraft(draft, { type: 'add-recipe', id: 'reading' });
  expect(configurationFor(settingsFromDraft(draft)).recipes.at(-1)?.presetId).toBe(writing);
});
