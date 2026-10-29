import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createSettingsOwner,
  DEFAULT_SETTINGS,
  getSettings,
  InvalidStoredSettingsError,
  validateProviderSettings,
} from '../src/storage/settings';

const get = vi.fn();
const set = vi.fn();
beforeEach(() => {
  get.mockReset();
  set.mockReset();
  vi.stubGlobal('chrome', { storage: { local: { get, set } } });
});
afterEach(() => vi.unstubAllGlobals());
it('retains saved on-device settings while requiring an explicit enabled provider choice', async () => {
  get.mockResolvedValueOnce({ saul_user_settings: { activeProvider: 'chrome-ai' } });
  const settings = await getSettings();
  expect(settings.activeProvider).toBe('chrome-ai');
  expect(() => validateProviderSettings(settings)).toThrow('temporarily disabled');
  expect(set).not.toHaveBeenCalled();
});

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
it('defaults PDFs to URL attachments, persists an explicit local choice, and rejects invalid saved modes', async () => {
  get.mockResolvedValue({ saul_user_settings: {} });
  expect((await getSettings()).summaryPdfProcessing).toBe('attachment');
  get.mockResolvedValue({ saul_user_settings: { summaryPdfProcessing: 'local' } });
  expect((await getSettings()).summaryPdfProcessing).toBe('local');
  for (const summaryPdfProcessing of ['auto', true, null, 0]) {
    get.mockResolvedValue({ saul_user_settings: { summaryPdfProcessing } });
    await expect(getSettings()).rejects.toThrow(/PDF processing/);
  }
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
    {
      id: 'recovered-current',
      name: 'Recovered current settings',
      config: { ...DEFAULT_SETTINGS.openaiCompatible, baseUrl: 'http://localhost:11434/v1' },
    },
  ]);
  expect(settings.activeProfileId).toBe('recovered-current');
  expect(settings.configuration?.presets[0]?.profileId).toBe('recovered-current');
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
  await expect(createSettingsOwner()({ action: 'read' })).rejects.toThrow(
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
  const owner = createSettingsOwner();
  const state = await owner({ action: 'read' });
  if (state.state !== 'invalid') throw new Error('Expected invalid settings');
  await expect(owner({ action: 'reset', baseline: state.revision })).resolves.toMatchObject({
    state: 'ready',
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
  const owner = createSettingsOwner();
  const state = await owner({ action: 'read' });
  if (state.state !== 'ready') throw new Error('Expected ready settings');
  await expect(owner({ action: 'reset', baseline: state.revision })).resolves.toMatchObject({
    state: 'ready',
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
    .mockResolvedValue({ saul_user_settings: stored });
  await expect(getSettings()).rejects.toThrow();
  const owner = createSettingsOwner();
  const state = await owner({ action: 'read' });
  if (state.state !== 'ready') throw new Error('Expected ready settings');
  await owner({
    action: 'commit',
    baseline: state.revision,
    settings: { ...state.settings, responseLanguage: 'Chinese' },
  });
  expect(set).toHaveBeenCalledWith({
    saul_user_settings: { ...stored, responseLanguage: 'Chinese' },
  });
});
