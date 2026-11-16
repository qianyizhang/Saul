import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { chromeConfigurationStorage } from '../src/configuration/chrome-storage';
import { createConfigurationStore } from '../src/configuration/store';
import { decodeConfiguration } from '../src/configuration/record';
import { DEFAULT_CONFIGURATION } from '../src/configuration/definition';
import { preparePreset } from '../src/configuration/resolve';
const get = vi.fn(),
  set = vi.fn();
beforeEach(() => {
  get.mockReset();
  set.mockReset();
  vi.stubGlobal('chrome', { storage: { local: { get, set } } });
});
afterEach(() => vi.unstubAllGlobals());
const read = () => createConfigurationStore(chromeConfigurationStorage)({ action: 'read' });
it('uses detached defaults only for absent configuration', async () => {
  get.mockResolvedValue({});
  const a = await read();
  expect(a).toMatchObject({ state: 'ready', settings: DEFAULT_CONFIGURATION });
  if (a.state !== 'ready') throw new Error('Expected defaults');
  a.settings.connections[0]!.name = 'Changed';
  expect(await read()).toMatchObject({ state: 'ready', settings: DEFAULT_CONFIGURATION });
  get.mockResolvedValue({ saul_user_settings: {} });
  expect(await read()).toMatchObject({
    state: 'invalid',
    error: expect.stringContaining('configuration is missing'),
  });
  expect(set).not.toHaveBeenCalled();
});
it('validates current records and preserves optional PDF preferences', () => {
  expect(decodeConfiguration(DEFAULT_CONFIGURATION)).toEqual(DEFAULT_CONFIGURATION);
  expect(
    decodeConfiguration({ ...DEFAULT_CONFIGURATION, summaryPdfProcessing: 'local' })
      .summaryPdfProcessing,
  ).toBe('local');
  for (const summaryPdfProcessing of ['auto', true, null, 0])
    expect(() => decodeConfiguration({ ...DEFAULT_CONFIGURATION, summaryPdfProcessing })).toThrow(
      'PDF processing',
    );
  for (const connections of [null, {}, [{ key: 'invalid' }]])
    expect(() => decodeConfiguration({ ...DEFAULT_CONFIGURATION, connections })).toThrow(
      'Connections need unique',
    );
});

it('rejects nested connection aliases instead of silently changing their meaning', () => {
  const configuration = structuredClone(DEFAULT_CONFIGURATION);
  expect(() =>
    decodeConfiguration({
      ...configuration,
      configuration: { ...configuration.configuration, providers: [] },
    }),
  ).toThrow('Obsolete configuration');
  expect(() =>
    decodeConfiguration({
      ...configuration,
      configuration: {
        ...configuration.configuration,
        presets: configuration.configuration!.presets.map((preset) => ({
          ...preset,
          providerKey: 'old',
        })),
      },
    }),
  ).toThrow('Obsolete preset');
});
it.each([
  { activeProvider: 'unknown' },
  { openaiCompatible: { temperature: 'warm' } },
  { contextPolicy: { includeSelection: 'yes' } },
  { sharedCredentials: 'other' },
  { providers: [] },
  { providerConnections: {} },
  { summaryProviderKey: 'old' },
])('preserves invalid records until an explicit backed-up reset: %j', async (patch) => {
  const invalid = { ...structuredClone(DEFAULT_CONFIGURATION), ...patch };
  get.mockResolvedValue({ saul_user_settings: invalid });
  const owner = createConfigurationStore(chromeConfigurationStorage);
  const result = await owner({ action: 'read' });
  expect(result.state).toBe('invalid');
  expect(set).not.toHaveBeenCalled();
  if (result.state !== 'invalid') throw new Error('Expected invalid record');
  expect(await owner({ action: 'reset', baseline: result.revision })).toMatchObject({
    state: 'ready',
    reset: true,
  });
  expect(set).toHaveBeenCalledWith({
    saul_user_settings: DEFAULT_CONFIGURATION,
    saul_user_settings_recovery_backup: invalid,
  });
});
it('preserves retired choices for explicit repair but never executes them', () => {
  const stored = structuredClone(DEFAULT_CONFIGURATION);
  stored.configuration!.presets[0]!.provider = 'chrome-ai';
  const settings = decodeConfiguration(stored);
  expect(() => preparePreset(settings, settings.configuration!.presets[0]!)).toThrow('retired');
});
it('does not replace unreadable configuration or poison a later request', async () => {
  get.mockRejectedValueOnce(new Error('Storage unavailable')).mockResolvedValue({});
  const owner = createConfigurationStore(chromeConfigurationStorage);
  await expect(owner({ action: 'read' })).rejects.toThrow('Could not read saved settings');
  expect(await owner({ action: 'read' })).toMatchObject({ state: 'ready' });
  expect(set).not.toHaveBeenCalled();
});
it('retains a valid record when reset is no longer needed', async () => {
  get.mockResolvedValue({ saul_user_settings: DEFAULT_CONFIGURATION });
  const owner = createConfigurationStore(chromeConfigurationStorage);
  const result = await owner({ action: 'read' });
  if (result.state !== 'ready') throw new Error('Expected current record');
  expect(await owner({ action: 'reset', baseline: result.revision })).toMatchObject({
    state: 'ready',
    reset: false,
  });
  expect(set).not.toHaveBeenCalled();
});
