import { expect, it, vi } from 'vitest';
import { createConfigurationStore, SETTINGS_STORAGE_KEY } from '../src/configuration/store';
import { DEFAULT_CONFIGURATION } from '../src/configuration/definition';
import { validateSettingsRequest, type SettingsState } from '../src/contracts/settings';
import { requestSettings, SettingsDeliveryError } from '../src/configuration/client';
import { createSettingsDraft, editSettingsDraft, settingsForSave } from '../src/settings/draft';
import { summaryConnections } from '../src/digest/connection';
import { preparePreset } from '../src/configuration/resolve';

it('saves an explicit preset repair while retaining a retired legacy default', async () => {
  const retiredConfiguration = structuredClone(DEFAULT_CONFIGURATION);
  retiredConfiguration.activeProvider = 'chrome-ai';
  retiredConfiguration.configuration!.presets[0]!.provider = 'chrome-ai';
  const f = fixture(retiredConfiguration);
  const before = ready(await f.owner({ action: 'read' }));
  const original = createSettingsDraft(before.settings);
  const retired = original.values.configuration.presets[0]!;
  expect(() => preparePreset(before.settings, retired)).toThrow('has been retired');
  let draft = editSettingsDraft(original, {
    type: 'preset-local-provider',
    provider: 'openai-compatible',
  });
  draft = editSettingsDraft(draft, { type: 'preset', patch: { model: 'fixture-model' } });
  draft = editSettingsDraft(draft, {
    type: 'connection',
    id: 'default',
    patch: { apiKey: 'fixture-key' },
  });
  const saved = ready(
    await f.owner({
      action: 'commit',
      baseline: before.revision,
      settings: settingsForSave(draft),
    }),
  );
  expect(saved.settings.activeProvider).toBe('chrome-ai');
  const repaired = saved.settings.configuration!.presets.find((p) => p.id === retired.id)!;
  expect(preparePreset(saved.settings, repaired)).toMatchObject({
    choices: { provider: 'openai-compatible', remote: { model: 'fixture-model' } },
    credential: 'fixture-key',
  });
  expect(() => preparePreset(saved.settings, retired)).toThrow('has been retired');
});

it('commits an unrelated edit after inspection without retargeting Original summary or API defaults', async () => {
  const source = structuredClone(DEFAULT_CONFIGURATION);
  source.chatgptPlan = { accountId: 'local-A', model: 'saved-model' };
  source.activeProfileId = 'default';
  source.profiles = [
    { id: 'default', name: 'Default', config: { ...source.openaiCompatible } },
    {
      id: 'other',
      name: 'Other',
      config: {
        ...source.openaiCompatible,
        baseUrl: 'https://other.example.test/v1',
        apiKey: 'fixture-key',
      },
    },
  ];
  source.connections.push({
    key: 'plan-b',
    name: 'Plan B',
    kind: 'chatgpt-plan',
    accountId: 'bound-B',
  });
  source.configuration!.presets.push(
    {
      id: 'plan-b',
      name: 'Plan B',
      provider: 'chatgpt-plan',
      connectionKey: 'plan-b',
      model: 'bound-model',
    },
    {
      id: 'other',
      name: 'Other',
      provider: 'openai-compatible',
      profileId: 'other',
      model: 'other-model',
    },
  );
  const f = fixture(source);
  const accounts = ['local-A', 'bound-B'].map((id) => ({
    id,
    label: id,
    signedIn: true,
    planEnabled: true,
  }));
  for (const id of ['plan-b', 'other']) {
    const before = ready(await f.owner({ action: 'read' }));
    let draft = editSettingsDraft(createSettingsDraft(before.settings), {
      type: 'select-preset',
      id,
    });
    draft = editSettingsDraft(draft, {
      type: 'settings',
      patch: { responseLanguage: id === 'plan-b' ? 'Chinese' : 'English' },
    });
    const payload = settingsForSave(draft);
    const saved = ready(
      await f.owner({ action: 'commit', baseline: before.revision, settings: payload }),
    );
    expect(saved.settings.openaiCompatible).toEqual(before.settings.openaiCompatible);
    expect(saved.settings.activeProfileId).toBe('default');
    expect(saved.settings.activeProvider).toBe(before.settings.activeProvider);
    expect(summaryConnections(saved.settings, accounts).chosen).toBe('');
  }
});

function fixture(initial?: unknown) {
  const values: Record<string, unknown> =
    initial === undefined ? {} : { [SETTINGS_STORAGE_KEY]: initial };
  const storage = {
    read: vi.fn(async () => structuredClone(values[SETTINGS_STORAGE_KEY])),
    write: vi.fn(async (patch: Record<string, unknown>) => {
      Object.assign(values, structuredClone(patch));
    }),
  };
  return { values, storage, owner: createConfigurationStore(storage) };
}
function ready(state: SettingsState) {
  expect(state.state).toBe('ready');
  if (state.state !== 'ready') throw new Error('Expected ready settings');
  return state;
}

it('repairing invalid shared settings keeps the credential route disconnected', async () => {
  const f = fixture({ sharedCredentials: 'saul', openaiCompatible: { temperature: 'invalid' } });
  const invalid = await f.owner({ action: 'read' });
  if (invalid.state !== 'invalid') throw new Error('Expected invalid shared settings');
  const reset = ready(await f.owner({ action: 'reset', baseline: invalid.revision }));
  expect(reset.settings.sharedCredentials).toBe('disconnected');
});

it('rejects a competing full draft without changing either draft or the first saved recipe', async () => {
  const f = fixture();
  const a = ready(await f.owner({ action: 'read' }));
  const b = ready(await f.owner({ action: 'read' }));
  expect(a.revision).toMatch(/^[a-f0-9]{64}$/);
  a.settings.configuration!.recipes[0]!.name = 'Saved in A';
  ready(await f.owner({ action: 'commit', baseline: a.revision, settings: a.settings }));
  b.settings.responseLanguage = 'Chinese';
  const retained = structuredClone(b);
  await expect(
    f.owner({ action: 'commit', baseline: b.revision, settings: b.settings }),
  ).resolves.toMatchObject({ state: 'conflict' });
  expect(b).toEqual(retained);
  const latest = ready(await f.owner({ action: 'read' }));
  expect(latest.settings.configuration!.recipes[0]!.name).toBe('Saved in A');
  expect(latest.settings.responseLanguage).toBeUndefined();
  expect(f.storage.write).toHaveBeenCalledTimes(1);
});

it('uses the loaded shared revisions when saving an edit, even if the submitted draft omits them', async () => {
  const f = fixture(DEFAULT_CONFIGURATION);
  const shared = structuredClone({
    ...DEFAULT_CONFIGURATION,
    sharedPresetRevision: 5,
    scopedConfigRevision: 9,
  });
  const save = vi.fn(async (next: typeof shared) => {
    if (next.sharedPresetRevision !== 5 || next.scopedConfigRevision !== 9)
      throw new Error('Wrong shared revisions');
    Object.assign(shared, next);
    return next;
  });
  const owner = createConfigurationStore(f.storage, {
    load: async () => structuredClone(shared),
    save,
  });
  const before = ready(await owner({ action: 'read' }));
  const draft = structuredClone(before.settings);
  delete draft.sharedPresetRevision;
  delete draft.scopedConfigRevision;
  const result = ready(
    await owner({
      action: 'commit',
      baseline: before.revision,
      settings: { ...draft, responseLanguage: 'Chinese' },
    }),
  );
  expect(result.settings.responseLanguage).toBe('Chinese');
  expect(shared.responseLanguage).toBe('Chinese');
  expect(save).toHaveBeenCalledTimes(1);
});

it('serializes simultaneous commits and checks the baseline after an earlier write settles', async () => {
  const f = fixture();
  const original = ready(await f.owner({ action: 'read' }));
  let release!: () => void;
  let started!: () => void;
  const writing = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const write = f.storage.write.getMockImplementation()!;
  f.storage.write.mockImplementationOnce(async (patch) => {
    started();
    await gate;
    await write(patch);
  });
  const first = f.owner({
    action: 'commit',
    baseline: original.revision,
    settings: { ...original.settings, responseLanguage: 'English' },
  });
  await writing;
  const second = f.owner({
    action: 'commit',
    baseline: original.revision,
    settings: { ...original.settings, responseLanguage: 'Chinese' },
  });
  release();
  expect((await first).state).toBe('ready');
  expect((await second).state).toBe('conflict');
  expect(ready(await f.owner({ action: 'read' })).settings.responseLanguage).toBe('English');
  expect(f.storage.write).toHaveBeenCalledTimes(1);
});

it('accepts subsequent saves after Chrome reorders nested storage object keys', async () => {
  const f = fixture();
  const write = f.storage.write.getMockImplementation()!;
  f.storage.write.mockImplementation(async (patch) => {
    const roundTripped = JSON.parse(
      JSON.stringify(patch, (_key, value: unknown) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).reverse())
          : value,
      ),
    ) as Record<string, unknown>;
    await write(roundTripped);
  });
  const original = ready(await f.owner({ action: 'read' }));
  const first = ready(
    await f.owner({ action: 'commit', baseline: original.revision, settings: original.settings }),
  );
  expect(ready(await f.owner({ action: 'read' })).revision).toBe(first.revision);
  const second = ready(
    await f.owner({
      action: 'commit',
      baseline: first.revision,
      settings: { ...first.settings, responseLanguage: 'Chinese' },
    }),
  );
  expect(second.settings.responseLanguage).toBe('Chinese');
  expect(f.storage.write).toHaveBeenCalledTimes(2);
});

it('keeps revisions useful after a background restart and excludes unrelated preferences', async () => {
  const f = fixture({ ...DEFAULT_CONFIGURATION, responseLanguage: 'English' });
  const baseline = ready(await f.owner({ action: 'read' }));
  f.values.saul_minimum_mode = false;
  const restarted = createConfigurationStore(f.storage);
  expect(ready(await restarted({ action: 'read' })).revision).toBe(baseline.revision);
  ready(
    await restarted({
      action: 'commit',
      baseline: baseline.revision,
      settings: { ...baseline.settings, responseLanguage: 'Chinese' },
    }),
  );
  expect(f.values.saul_minimum_mode).toBe(false);
  await expect(
    f.owner({ action: 'commit', baseline: baseline.revision, settings: baseline.settings }),
  ).resolves.toMatchObject({ state: 'conflict' });
});

it('does not rewrite invalid records on read and keeps invalid recovery in the same lane', async () => {
  const malformed = { openaiCompatible: { temperature: 'hot' } };
  const f = fixture(malformed);
  const bad = await f.owner({ action: 'read' });
  if (bad.state !== 'invalid') throw new Error('Expected invalid fixture');
  expect(f.values[SETTINGS_STORAGE_KEY]).toEqual(malformed);
  expect(f.storage.write).not.toHaveBeenCalled();
  await expect(
    f.owner({ action: 'commit', baseline: bad.revision, settings: DEFAULT_CONFIGURATION }),
  ).rejects.toThrow('Saved settings need repair');
  const [reset, stale] = await Promise.all([
    f.owner({ action: 'reset', baseline: bad.revision }),
    f.owner({
      action: 'commit',
      baseline: bad.revision,
      settings: { ...DEFAULT_CONFIGURATION, responseLanguage: 'Chinese' },
    }),
  ]);
  expect(reset).toMatchObject({ state: 'ready', reset: true });
  expect(stale.state).toBe('conflict');
  expect(f.values.saul_user_settings_recovery_backup).toEqual(malformed);
  expect(f.storage.write).toHaveBeenCalledTimes(1);
});

it('rejects obsolete aliases without rewriting the stored record', async () => {
  const obsolete = { ...DEFAULT_CONFIGURATION, providers: DEFAULT_CONFIGURATION.connections };
  const f = fixture(obsolete);
  expect(await f.owner({ action: 'read' })).toMatchObject({
    state: 'invalid',
    error: expect.stringContaining('Obsolete'),
  });
  expect(f.storage.write).not.toHaveBeenCalled();
  expect(f.values[SETTINGS_STORAGE_KEY]).toEqual(obsolete);
});

it('a stale recovery request cannot replace newly valid settings or its existing backup', async () => {
  const f = fixture({ activeProvider: 'unknown' });
  const bad = await f.owner({ action: 'read' });
  if (bad.state !== 'invalid') throw new Error('Expected invalid fixture');
  f.values[SETTINGS_STORAGE_KEY] = DEFAULT_CONFIGURATION;
  f.values.saul_user_settings_recovery_backup = { retained: true };
  await expect(f.owner({ action: 'reset', baseline: bad.revision })).resolves.toMatchObject({
    state: 'conflict',
  });
  expect(f.values.saul_user_settings_recovery_backup).toEqual({ retained: true });
  expect(f.storage.write).not.toHaveBeenCalled();
});

it('preserves baseline and data after a failed write and does not poison later requests', async () => {
  const f = fixture();
  const baseline = ready(await f.owner({ action: 'read' }));
  const request = {
    action: 'commit',
    baseline: baseline.revision,
    settings: { ...baseline.settings, responseLanguage: 'Chinese' },
  };
  f.storage.write.mockRejectedValueOnce(new Error('Synthetic disk failure'));
  await expect(f.owner(request)).rejects.toThrow('Synthetic disk failure');
  expect(ready(await f.owner({ action: 'read' })).revision).toBe(baseline.revision);
  ready(await f.owner(request));
  expect(ready(await f.owner({ action: 'read' })).settings.responseLanguage).toBe('Chinese');
});

it('leaves the recovery backup untouched when connecting to the signed owner', async () => {
  const f = fixture();
  f.values.saul_user_settings_recovery_backup = { apiKey: 'backup-secret' };
  const credentials = {
    prepare: vi.fn(async (settings: typeof DEFAULT_CONFIGURATION) => settings),
  };
  const owner = createConfigurationStore(f.storage, undefined, credentials);
  const before = ready(await owner({ action: 'read' }));
  const request = {
    action: 'commit',
    baseline: before.revision,
    settings: { ...before.settings, sharedCredentials: 'saul' },
  };
  f.storage.write.mockRejectedValueOnce(new Error('Local write failed'));
  await expect(owner(request)).rejects.toThrow('Local write failed');
  expect(f.values.saul_user_settings_recovery_backup).toEqual({ apiKey: 'backup-secret' });
  await owner(request);
  expect(f.storage.write).toHaveBeenLastCalledWith({
    [SETTINGS_STORAGE_KEY]: request.settings,
  });
  expect(f.values.saul_user_settings_recovery_backup).toEqual({ apiKey: 'backup-secret' });
});

it('validates incoming configuration and does not leak credentials into revision/error fields', async () => {
  const f = fixture({
    ...DEFAULT_CONFIGURATION,
    openaiCompatible: { ...DEFAULT_CONFIGURATION.openaiCompatible, apiKey: 'private-fixture' },
  });
  const baseline = ready(await f.owner({ action: 'read' }));
  expect(baseline.revision).not.toContain('private-fixture');
  await expect(
    f.owner({
      action: 'commit',
      baseline: baseline.revision,
      settings: { ...baseline.settings, activeProvider: 'unknown' },
    }),
  ).rejects.toThrow('provider is not supported');
  await expect(
    f.owner({
      action: 'commit',
      baseline: baseline.revision,
      settings: { ...baseline.settings, configuration: { schemaVersion: 99 } },
    }),
  ).rejects.toThrow('Unsupported configuration');
  expect(f.storage.write).not.toHaveBeenCalled();
});

it('rejects malformed transport operations before accessing storage', async () => {
  const f = fixture();
  for (const value of [
    null,
    {},
    { action: 'read', extra: true },
    { action: 'reset', baseline: 'secret' },
    { action: 'commit', baseline: 'a'.repeat(64), settings: [] },
    { action: 'commit', baseline: 'a'.repeat(64), settings: {} },
    { action: 'commit', baseline: 'a'.repeat(64), settings: { responseLanguage: 'Chinese' } },
  ]) {
    expect(() => validateSettingsRequest(value)).toThrow();
    await expect(f.owner(value)).rejects.toThrow();
  }
  expect(f.storage.read).not.toHaveBeenCalled();
});

it('reports uncertain delivery without retrying a lost commit response', async () => {
  const sendMessage = vi.fn().mockRejectedValue(new Error('Port closed'));
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  try {
    await expect(
      requestSettings({
        action: 'commit',
        baseline: 'a'.repeat(64),
        settings: DEFAULT_CONFIGURATION,
      }),
    ).rejects.toBeInstanceOf(SettingsDeliveryError);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    sendMessage.mockResolvedValueOnce(undefined);
    await expect(requestSettings({ action: 'reset', baseline: 'a'.repeat(64) })).rejects.toThrow(
      'outcome is unknown',
    );
    expect(sendMessage).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
  }
});
