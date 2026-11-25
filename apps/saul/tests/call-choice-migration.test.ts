import { describe, expect, it } from 'vitest';
import { legacySummaryPreset } from '../src/calls/choice-migration';
import {
  DEFAULT_CONFIGURATION,
  starterConfiguration,
  type Configuration,
} from '../src/configuration/definition';
import type { ModelPreset } from '../shared/model/presets.ts';

const match: ModelPreset = {
  id: 'bound-luna',
  name: 'Luna',
  provider: 'chatgpt-plan',
  capability: 'write',
  connectionKey: 'gpt-plan',
  model: 'gpt-6-luna',
  effort: 'medium',
  fast: false,
};

function settingsWith(...presets: ModelPreset[]): Configuration {
  const settings: Configuration = {
    ...DEFAULT_CONFIGURATION,
    sharedCredentials: 'saul',
    summaryConnectionKey: 'gpt-plan',
    connections: [
      { key: 'gpt-plan', name: 'Bound plan', kind: 'chatgpt-plan', accountId: 'bound' },
      { key: 'other', name: 'Other plan', kind: 'chatgpt-plan', accountId: 'other' },
    ],
  };
  settings.configuration = {
    ...starterConfiguration(settings),
    presets,
  };
  return settings;
}

describe('Original summary setup migration', () => {
  it('keeps an explicit legacy reference without resolving or replacing it', () => {
    const settings = { ...settingsWith(match), summaryPresetId: 'deleted-preset' };
    expect(legacySummaryPreset(settings)).toBe('deleted-preset');
  });

  it('uses only one eligible exact preset on the previously bound connection', () => {
    const unrelated = { ...match, id: 'wrong-connection', connectionKey: 'other' };
    expect(legacySummaryPreset(settingsWith(unrelated, match))).toBe(match.id);
    expect(
      legacySummaryPreset(settingsWith(unrelated, match, { ...match, id: 'also-exact' })),
    ).toBeUndefined();
  });

  it.each([
    { connectionKey: 'other' },
    { model: 'gpt-6' },
    { effort: 'high' },
    { fast: true },
    { capability: 'speak' as const },
  ])('needs a choice for a mismatch %o', (change) => {
    expect(legacySummaryPreset(settingsWith({ ...match, ...change }))).toBeUndefined();
  });

  it('needs a choice when there is no bound account', () => {
    const settings = settingsWith(match);
    expect(legacySummaryPreset({ ...settings, summaryConnectionKey: undefined })).toBeUndefined();
    expect(
      legacySummaryPreset({
        ...settings,
        connections: [{ key: 'gpt-plan', name: 'Bound plan', kind: 'chatgpt-plan' }],
      }),
    ).toBeUndefined();
  });
});
