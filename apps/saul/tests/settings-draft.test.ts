import { expect, it } from 'vitest';
import {
  createSettingsDraft,
  editSettingsDraft,
  settingsForSave,
} from '../src/models/settings-draft';
import { DEFAULT_SETTINGS } from '../src/storage/settings';
import { configurationFor } from '../src/models/configuration';

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
  expect(draft.settings.openaiCompatible).toMatchObject({
    apiKey: 'first-key',
    model: 'first-model',
  });
  draft = editSettingsDraft(draft, { type: 'select-preset', id: 'another' });
  expect(draft.settings.openaiCompatible).toMatchObject({
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
  expect(draft.settings.profiles![0]!.config.apiKey).toBe('private');
  draft = editSettingsDraft(draft, {
    type: 'connection',
    id: 'default',
    patch: { baseUrl: 'https://example.test/v1' },
  });
  expect(draft.settings.profiles![0]!.config.apiKey).toBe('');
});

it('owns recipe/preset references and preserves editing selection across unrelated changes', () => {
  let draft = createSettingsDraft(DEFAULT_SETTINGS);
  expect(() => editSettingsDraft(draft, { type: 'remove-preset' })).toThrow('used by');
  draft = editSettingsDraft(draft, { type: 'add-preset', id: 'spare' });
  draft = editSettingsDraft(draft, { type: 'add-recipe', id: 'new' });
  expect(configurationFor(draft.settings).recipes.at(-1)?.presetId).toBe('spare');
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
  expect(configurationFor(draft.settings).recipes[0]?.template).toBe('{{text');
  expect(configurationFor(DEFAULT_SETTINGS).recipes[0]?.template).not.toBe('{{text');
});

it('preserves a shared Draw preset through unrelated settings and provider-name edits', () => {
  const source = structuredClone(DEFAULT_SETTINGS);
  source.sharedPresetRevision = 2;
  source.providers = [
    { key: 'gpt-plan', name: 'Plan', kind: 'chatgpt-plan' },
    { key: 'openai-api', name: 'API', kind: 'openai-api' },
  ];
  const image = {
    id: 'c14b29f3-3ec2-4efc-8bed-e05531aef2cb',
    name: 'Illustration',
    provider: 'openai-compatible' as const,
    providerKey: 'openai-api',
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
  draft = editSettingsDraft(draft, { type: 'provider-name', key: 'openai-api', name: 'My API' });
  const saved = settingsForSave(draft);
  expect(saved.configuration!.presets.find((p) => p.id === image.id)).toEqual(image);
  expect(saved.providers?.[1]).toEqual({ key: 'openai-api', name: 'My API', kind: 'openai-api' });
});

it('edits provider connections without overwriting a selected Speak or Write preset', () => {
  let draft = createSettingsDraft(DEFAULT_SETTINGS);
  draft = editSettingsDraft(draft, { type: 'preset', patch: { model: 'write-choice' } });
  const write = structuredClone(configurationFor(draft.settings).presets[0]);
  draft = editSettingsDraft(draft, {
    type: 'connection',
    id: 'default',
    patch: { apiKey: 'private', baseUrl: 'https://api.openai.com/v1' },
  });
  expect(configurationFor(draft.settings).presets[0]).toEqual(write);
  draft = editSettingsDraft(draft, { type: 'add-preset', id: 'speak' });
  draft = editSettingsDraft(draft, { type: 'preset-provider', key: 'openai-api' });
  draft = editSettingsDraft(draft, { type: 'preset', patch: { capability: 'speak' } });
  draft = editSettingsDraft(draft, {
    type: 'preset',
    patch: { speechOptions: { voice: 'cedar' } },
  });
  const speech = structuredClone(configurationFor(draft.settings).presets.at(-1));
  draft = editSettingsDraft(draft, { type: 'plan-account', accountId: 'explicit-account' });
  draft = editSettingsDraft(draft, {
    type: 'connection',
    id: 'default',
    patch: { baseUrl: 'https://example.test/v1' },
  });
  expect(configurationFor(draft.settings).presets.at(-1)).toEqual(speech);
  expect(draft.settings.profiles![0]!.config.apiKey).toBe('');
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
  draft = editSettingsDraft(draft, { type: 'preset-provider', key: 'openai-api' });
  draft = editSettingsDraft(draft, { type: 'preset', patch: { capability: 'speak' } });
  draft = editSettingsDraft(draft, { type: 'add-recipe', id: 'reading' });
  expect(configurationFor(draft.settings).recipes.at(-1)?.presetId).toBe(writing);
});
