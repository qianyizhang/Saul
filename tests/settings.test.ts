import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  backupAndResetInvalidSettings,
  DEFAULT_SETTINGS,
  getSettings,
  InvalidStoredSettingsError,
  saveSettings,
} from '../src/storage/settings';

const get = vi.fn();
const set = vi.fn();
beforeEach(() => {
  get.mockReset();
  set.mockReset();
  vi.stubGlobal('chrome', { storage: { local: { get, set } } });
});
afterEach(() => vi.unstubAllGlobals());

it('uses defaults for absent settings and retains nested defaults for older records', async () => {
  get.mockResolvedValueOnce({});
  await expect(getSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  get.mockResolvedValueOnce({
    saul_user_settings: { contextPolicy: { includePageMetadata: false } },
  });
  const settings = await getSettings();
  expect(settings.contextPolicy).toEqual({
    ...DEFAULT_SETTINGS.contextPolicy,
    includePageMetadata: false,
  });
});

it('normalizes partial legacy provider records without dropping nested defaults', async () => {
  get.mockResolvedValue({
    saul_user_settings: {
      openaiCompatible: { baseUrl: 'http://localhost:11434/v1' },
      profiles: [{ id: 'legacy', name: 'Legacy', config: { model: 'legacy-model' } }],
      activeProfileId: 'legacy',
    },
  });
  const settings = await getSettings();
  expect(settings.openaiCompatible).toEqual({
    ...DEFAULT_SETTINGS.openaiCompatible,
    baseUrl: 'http://localhost:11434/v1',
  });
  expect(settings.profiles).toEqual([
    {
      id: 'legacy',
      name: 'Legacy',
      config: { ...DEFAULT_SETTINGS.openaiCompatible, model: 'legacy-model' },
    },
  ]);
});

it.each([
  ['missing', undefined, 'recovered-current'],
  ['stale', 'retired-profile', 'retired-profile'],
] as const)(
  'recovers the current provider config when the active profile is %s',
  async (_case, storedActiveProfileId, recoveredId) => {
    get.mockResolvedValue({
      saul_user_settings: {
        openaiCompatible: {
          baseUrl: 'http://localhost:11434/v1',
          apiKey: 'current-key',
          model: 'current-model',
          temperature: 0.7,
        },
        profiles: [{ id: 'legacy', name: 'Legacy', config: { model: 'legacy-model' } }],
        ...(storedActiveProfileId === undefined ? {} : { activeProfileId: storedActiveProfileId }),
      },
    });
    const settings = await getSettings();
    expect(settings.activeProfileId).toBe(recoveredId);
    expect(settings.profiles).toEqual([
      {
        id: 'legacy',
        name: 'Legacy',
        config: { ...DEFAULT_SETTINGS.openaiCompatible, model: 'legacy-model' },
      },
      {
        id: recoveredId,
        name: 'Recovered current settings',
        config: {
          baseUrl: 'http://localhost:11434/v1',
          apiKey: 'current-key',
          model: 'current-model',
          temperature: 0.7,
        },
      },
    ]);
  },
);

it('retains an intentionally blank profile name', async () => {
  get.mockResolvedValue({
    saul_user_settings: {
      profiles: [{ id: 'unnamed', name: '', config: {} }],
      activeProfileId: 'unnamed',
    },
  });
  const settings = await getSettings();
  expect(settings.profiles?.[0]).toMatchObject({ id: 'unnamed', name: '' });
  expect(settings.activeProfileId).toBe('unnamed');
});

it.each([
  [{ activeProvider: 'future-provider' }, 'Saved provider is not supported.'],
  [
    { openaiCompatible: { temperature: 'warm' } },
    'Saved provider temperature must be a finite number.',
  ],
  [
    { contextPolicy: { includePageMetadata: 'yes' } },
    'Saved page-metadata setting must be true or false.',
  ],
  [
    { profiles: [{ id: 'missing-name', config: {} }] },
    'Saved provider profiles require an ID and name.',
  ],
  [
    {
      profiles: [
        { id: 'same', name: 'First' },
        { id: 'same', name: 'Second' },
      ],
    },
    'Saved provider profile IDs must be unique.',
  ],
] as const)(
  'identifies malformed saved settings without leaking invalid runtime types: %o',
  async (stored, detail) => {
    get.mockResolvedValue({ saul_user_settings: stored });
    await expect(getSettings()).rejects.toMatchObject({
      name: 'InvalidStoredSettingsError',
      message: expect.stringContaining(detail),
    });
    await expect(getSettings()).rejects.toBeInstanceOf(InvalidStoredSettingsError);
    expect(set).not.toHaveBeenCalled();
  },
);

it('does not silently replace unreadable settings with defaults or write over them', async () => {
  get.mockRejectedValue(new Error('Storage unavailable'));
  await expect(getSettings()).rejects.toThrow('Could not read saved settings');
  await expect(saveSettings({ responseLanguage: 'Chinese' })).rejects.toThrow(
    'Could not read saved settings',
  );
  expect(set).not.toHaveBeenCalled();
});

it('backs up the current invalid value and resets settings in one write', async () => {
  const invalid = { openaiCompatible: { temperature: 'warm' } };
  get.mockResolvedValue({
    saul_user_settings: invalid,
    saul_user_settings_recovery_backup: { older: true },
  });
  await expect(backupAndResetInvalidSettings()).resolves.toEqual({
    settings: DEFAULT_SETTINGS,
    reset: true,
  });
  expect(set).toHaveBeenCalledTimes(1);
  expect(set).toHaveBeenCalledWith({
    saul_user_settings_recovery_backup: invalid,
    saul_user_settings: DEFAULT_SETTINGS,
  });
});

it('does not overwrite settings that became valid before recovery was confirmed', async () => {
  get.mockResolvedValue({ saul_user_settings: DEFAULT_SETTINGS });
  await expect(backupAndResetInvalidSettings()).resolves.toEqual({
    settings: DEFAULT_SETTINGS,
    reset: false,
  });
  expect(set).not.toHaveBeenCalled();
});

it('allows a later retry without losing an existing provider profile', async () => {
  const stored = {
    ...DEFAULT_SETTINGS,
    profiles: [{ id: 'local', name: 'Local', config: DEFAULT_SETTINGS.openaiCompatible }],
    activeProfileId: 'local',
  };
  get
    .mockRejectedValueOnce(new Error('Storage unavailable'))
    .mockResolvedValueOnce({ saul_user_settings: stored });
  await expect(getSettings()).rejects.toThrow();
  await saveSettings({ responseLanguage: 'Chinese' });
  expect(set).toHaveBeenCalledWith({
    saul_user_settings: { ...stored, responseLanguage: 'Chinese' },
  });
});
