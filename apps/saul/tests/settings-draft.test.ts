import { expect, it } from 'vitest';
import {
  createSettingsDraft,
  editSettingsDraft,
  settingsForSave,
} from '../src/models/settings-draft';
import { DEFAULT_SETTINGS } from '../src/storage/settings';
import { configurationFor } from '../src/models/configuration';

it('keeps profile credentials and model choices when switching presets and profiles', () => {
  let draft = createSettingsDraft(DEFAULT_SETTINGS);
  draft = editSettingsDraft(draft, {
    type: 'remote',
    patch: { apiKey: 'first-key', model: 'first-model' },
  });
  draft = editSettingsDraft(draft, { type: 'add-profile', id: 'second' });
  expect(draft.settings.openaiCompatible.apiKey).toBe('');
  draft = editSettingsDraft(draft, {
    type: 'remote',
    patch: { apiKey: 'second-key', model: 'second-model' },
  });
  draft = editSettingsDraft(draft, { type: 'select-profile', id: 'default' });
  expect(draft.settings.openaiCompatible).toMatchObject({
    apiKey: 'first-key',
    model: 'first-model',
  });
  draft = editSettingsDraft(draft, { type: 'add-preset', id: 'another' });
  draft = editSettingsDraft(draft, { type: 'select-profile', id: 'second' });
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
  draft = editSettingsDraft(draft, { type: 'remote', patch: { apiKey: 'private' } });
  draft = editSettingsDraft(draft, {
    type: 'remote',
    patch: { baseUrl: 'https://api.openai.com/other' },
  });
  expect(draft.settings.openaiCompatible.apiKey).toBe('private');
  draft = editSettingsDraft(draft, {
    type: 'remote',
    patch: { baseUrl: 'https://example.test/v1' },
  });
  expect(draft.settings.openaiCompatible.apiKey).toBe('');
  expect(draft.settings.profiles?.[0]?.config.apiKey).toBe('');
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
  expect(configurationFor(settingsForSave(draft)).recipes).toHaveLength(3);
});

it('keeps invalid edits in the draft until explicit validation succeeds', () => {
  let draft = createSettingsDraft(DEFAULT_SETTINGS);
  draft = editSettingsDraft(draft, { type: 'recipe', patch: { template: '{{text' } });
  expect(() => settingsForSave(draft)).toThrow('Close each input');
  expect(configurationFor(draft.settings).recipes[0]?.template).toBe('{{text');
  expect(configurationFor(DEFAULT_SETTINGS).recipes[0]?.template).not.toBe('{{text');
});
