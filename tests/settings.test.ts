import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, getSettings, saveSettings } from '../src/storage/settings';

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

it('does not silently replace unreadable settings with defaults or write over them', async () => {
  get.mockRejectedValue(new Error('Storage unavailable'));
  await expect(getSettings()).rejects.toThrow('Could not load saved settings');
  await expect(saveSettings({ responseLanguage: 'Chinese' })).rejects.toThrow(
    'Could not load saved settings',
  );
  expect(set).not.toHaveBeenCalled();
});

it('allows a later retry without losing an existing provider profile', async () => {
  const stored = {
    ...DEFAULT_SETTINGS,
    profiles: [{ id: 'local', name: 'Local', config: DEFAULT_SETTINGS.openaiCompatible }],
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
