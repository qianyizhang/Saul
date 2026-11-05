import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/storage/settings';
import { starterConfiguration } from '../src/models/configuration';
import {
  preparePreset,
  prepareFrozenPreset,
  SELECT_NEW_PRESET,
} from '../src/models/preset-resolution';
import { prepareRecipeRun } from '../src/reading/configuration';
import { prepareActionPreset } from '../src/actions/configuration';
import { planEvents } from '../src/models/chatgpt-plan';

function settings() {
  const value = structuredClone(DEFAULT_SETTINGS);
  value.activeProfileId = 'original';
  value.openaiCompatible = {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'fixture-key',
    model: 'fixture',
    temperature: 0.3,
  };
  value.profiles = [{ id: 'original', name: 'Original', config: { ...value.openaiCompatible } }];
  value.configuration = starterConfiguration(value);
  return value;
}
const context = { selection: 'source', pageTitle: 'Title', pageUrl: 'https://example.test' };
afterEach(() => vi.unstubAllGlobals());

it('Reading and custom Summarize use the same frozen choices and never persist a key', () => {
  const value = settings();
  const reading = prepareRecipeRun(value, context, value.configuration!.selectedRecipeId);
  const action = prepareActionPreset(value, value.configuration!.presets[0]!.id);
  for (const field of ['provider', 'remote', 'plan', 'preset', 'credentialOwner'] as const)
    expect(action.input[field]).toEqual(reading.input[field]);
  expect(reading.credential).toBe('fixture-key');
  expect(JSON.stringify(reading.input)).not.toContain('fixture-key');
  expect(reading.input.preset?.profileId).toBe('original');
});

it('rejects both credential-owner changes, including legacy requests, without changing the saved input', () => {
  const value = settings();
  const original = prepareRecipeRun(value, context, value.configuration!.selectedRecipeId).input;
  const before = structuredClone(original);
  value.sharedCredentials = 'saul';
  value.profiles![0]!.config.credentialOwner = 'saul';
  for (const input of [original, { ...original, credentialOwner: undefined }])
    expect(() => prepareFrozenPreset(value, input)).toThrow(SELECT_NEW_PRESET);
  expect(original).toEqual(before);
  const shared = prepareRecipeRun(value, context, value.configuration!.selectedRecipeId).input;
  delete value.profiles![0]!.config.credentialOwner;
  expect(() => prepareFrozenPreset(value, shared)).toThrow(SELECT_NEW_PRESET);
});

it('retains the original Connection when the Provider is rebound to another profile', () => {
  const value = settings();
  const preset = { ...value.configuration!.presets[0]!, connectionKey: 'openai-api' };
  value.connectionProfiles = { 'openai-api': 'original' };
  const prepared = preparePreset(value, preset);
  value.profiles!.push({
    id: 'other',
    name: 'Other',
    config: { ...value.openaiCompatible, apiKey: 'other-key' },
  });
  value.connectionProfiles['openai-api'] = 'other';
  const input = { ...prepared.choices, context, systemPrompt: '', userPrompt: 'source' };
  expect(prepareFrozenPreset(value, input).credential).toBe('fixture-key');
  value.profiles!.shift();
  expect(() => prepareFrozenPreset(value, input)).toThrow('saved connection');
});

it('freezes the plan owner and blocks a changed route again immediately before transport', async () => {
  const value = settings();
  value.chatgptPlan = { accountId: 'account', model: 'fixture' };
  const preset = { ...value.configuration!.presets[0]!, provider: 'chatgpt-plan' as const };
  const prepared = preparePreset(value, preset);
  value.sharedCredentials = 'saul';
  const input = { ...prepared.choices, context, systemPrompt: '', userPrompt: 'source' };
  expect(() => prepareFrozenPreset(value, input)).toThrow(SELECT_NEW_PRESET);
  const connect = vi.fn();
  vi.stubGlobal('chrome', {
    runtime: {
      connect,
      sendMessage: vi.fn().mockResolvedValue({ success: true, result: { mode: 'saul' } }),
    },
  });
  const stream = planEvents(
    {
      action: 'generate',
      accountId: 'account',
      model: 'fixture',
      systemPrompt: '',
      userPrompt: 'source',
    },
    undefined,
    'local',
  );
  await expect(stream.next()).rejects.toThrow(SELECT_NEW_PRESET);
  expect(connect).not.toHaveBeenCalled();
});

it('inspection needs no key, while actual execution still rejects a missing key', () => {
  const value = settings();
  value.profiles![0]!.config.apiKey = '';
  const preset = value.configuration!.presets[0]!;
  expect(preparePreset(value, preset, 'write', true).credential).toBe('');
  expect(() => preparePreset(value, preset)).toThrow('API key');
});
