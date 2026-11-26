import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIGURATION } from '../src/configuration/definition';
import { starterConfiguration } from '../src/configuration/definition';
import {
  preparePreset,
  prepareWritePreset,
  prepareFrozenPreset,
  SELECT_NEW_PRESET,
} from '../src/configuration/resolver';
import { prepareRecipeRun } from '../src/reading/configuration';
import { planEvents } from '../src/providers/chatgpt-plan';

function settings() {
  const value = structuredClone(DEFAULT_CONFIGURATION);
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
  const action = prepareWritePreset(value, value.configuration!.presets[0]!.id);
  for (const field of ['provider', 'remote', 'plan', 'preset', 'credentialOwner'] as const)
    expect(action.choices[field]).toEqual(reading.input[field]);
  expect(action.choices).not.toHaveProperty('context');
  expect(action.choices).not.toHaveProperty('userPrompt');
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

it('keeps an explicit local API profile usable without falling back from a linked connection', () => {
  const value = settings();
  value.sharedCredentials = 'disconnected';
  const preset = { ...value.configuration!.presets[0]!, connectionKey: undefined };
  expect(preparePreset(value, preset).credential).toBe('fixture-key');
  const linked = { ...preset, connectionKey: 'openai-api' };
  value.connectionProfiles = { 'openai-api': 'original' };
  expect(() => preparePreset(value, linked)).toThrow('Integrations');
});

it('freezes the plan owner and blocks a changed route again immediately before transport', async () => {
  const value = settings();
  value.chatgptPlan = { accountId: 'account', model: 'fixture' };
  const preset = { ...value.configuration!.presets[0]!, provider: 'chatgpt-plan' as const };
  expect(() => preparePreset(value, preset)).toThrow('Integrations');
  const prepared = preparePreset(value, preset, 'write', true);
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

it('retries only the frozen account of an available ChatGPT plan connection', () => {
  const value = settings();
  const connection = { key: 'gpt-plan', name: 'My plan', kind: 'chatgpt-plan' as const };
  value.connections = [connection];
  value.chatgptPlan = { accountId: 'standalone', model: 'fixture' };
  const preset = {
    ...value.configuration!.presets[0]!,
    provider: 'chatgpt-plan' as const,
    connectionKey: connection.key,
  };
  expect(() => preparePreset(value, preset)).toThrow('Integrations');
  const local = preparePreset(value, preset, 'write', true).choices;
  value.chatgptPlan.accountId = 'other';
  expect(() => prepareFrozenPreset(value, local)).toThrow(SELECT_NEW_PRESET);

  value.sharedCredentials = 'saul';
  value.connections = [{ ...connection, accountId: 'bound' }];
  const managed = preparePreset(value, preset).choices;
  expect(prepareFrozenPreset(value, managed).input.plan?.accountId).toBe('bound');
  expect(() => prepareFrozenPreset(value, local)).toThrow(SELECT_NEW_PRESET);
  for (const connections of [
    [],
    [connection],
    [{ ...connection, accountId: 'other' }],
    [{ ...connection, kind: 'openai-api' as const }],
  ])
    expect(() => prepareFrozenPreset({ ...value, connections }, managed)).toThrow(
      SELECT_NEW_PRESET,
    );
});

it('inspection needs no key, while actual execution still rejects a missing key', () => {
  const value = settings();
  value.profiles![0]!.config.apiKey = '';
  const preset = value.configuration!.presets[0]!;
  expect(preparePreset(value, preset, 'write', true).credential).toBe('');
  expect(() => preparePreset(value, preset)).toThrow('API key');
});
