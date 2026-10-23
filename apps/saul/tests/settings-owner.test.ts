import { expect, it, vi } from 'vitest';
import {
  createSettingsOwner,
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
} from '../src/storage/settings';
import { validateSettingsRequest, type SettingsState } from '../src/contracts/settings';
import { requestSettings, SettingsDeliveryError } from '../src/storage/settings-client';

function fixture(initial?: unknown) {
  const values: Record<string, unknown> =
    initial === undefined ? {} : { [SETTINGS_STORAGE_KEY]: initial };
  const storage = {
    read: vi.fn(async () => structuredClone(values[SETTINGS_STORAGE_KEY])),
    write: vi.fn(async (patch: Record<string, unknown>) => {
      Object.assign(values, structuredClone(patch));
    }),
  };
  return { values, storage, owner: createSettingsOwner(storage) };
}
function ready(state: SettingsState) {
  expect(state.state).toBe('ready');
  if (state.state !== 'ready') throw new Error('Expected ready settings');
  return state;
}

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
  const f = fixture({ responseLanguage: 'English' });
  const baseline = ready(await f.owner({ action: 'read' }));
  f.values.saul_minimum_mode = false;
  const restarted = createSettingsOwner(f.storage);
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

it('never writes migrated or invalid records on read and keeps invalid recovery in the same lane', async () => {
  const malformed = { openaiCompatible: { temperature: 'hot' } };
  const f = fixture(malformed);
  const bad = await f.owner({ action: 'read' });
  if (bad.state !== 'invalid') throw new Error('Expected invalid fixture');
  expect(f.values[SETTINGS_STORAGE_KEY]).toEqual(malformed);
  expect(f.storage.write).not.toHaveBeenCalled();
  await expect(
    f.owner({ action: 'commit', baseline: bad.revision, settings: DEFAULT_SETTINGS }),
  ).rejects.toThrow('Saved settings need repair');
  const [reset, stale] = await Promise.all([
    f.owner({ action: 'reset', baseline: bad.revision }),
    f.owner({
      action: 'commit',
      baseline: bad.revision,
      settings: { ...DEFAULT_SETTINGS, responseLanguage: 'Chinese' },
    }),
  ]);
  expect(reset).toMatchObject({ state: 'ready', reset: true });
  expect(stale.state).toBe('conflict');
  expect(f.values.saul_user_settings_recovery_backup).toEqual(malformed);
  expect(f.storage.write).toHaveBeenCalledTimes(1);
});

it('a stale recovery request cannot replace newly valid settings or its existing backup', async () => {
  const f = fixture({ activeProvider: 'unknown' });
  const bad = await f.owner({ action: 'read' });
  if (bad.state !== 'invalid') throw new Error('Expected invalid fixture');
  f.values[SETTINGS_STORAGE_KEY] = DEFAULT_SETTINGS;
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

it('validates incoming configuration and does not leak credentials into revision/error fields', async () => {
  const f = fixture({
    ...DEFAULT_SETTINGS,
    openaiCompatible: { ...DEFAULT_SETTINGS.openaiCompatible, apiKey: 'private-fixture' },
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
      requestSettings({ action: 'commit', baseline: 'a'.repeat(64), settings: DEFAULT_SETTINGS }),
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
