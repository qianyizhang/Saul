import { it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SharedPresetsStore } from '../native/shared-presets.mts';
import { sharedPresets } from '../src/storage/shared-presets';
import {
  createSettingsOwner,
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
} from '../src/storage/settings';

it('shares edits, migrates once, preserves local account bindings, and refuses a stale settings save', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'saul-shared-presets-'));
  try {
    const store = new SharedPresetsStore(join(directory, 'settings.json'));
    writeFileSync(store.path, JSON.stringify({ appearance: { theme: 'dark' } }));
    vi.stubGlobal('chrome', {
      runtime: {
        sendNativeMessage: async (
          _host: string,
          {
            id,
            request,
          }: {
            id: string;
            request: {
              action: string;
              revision: number;
              presets: Parameters<typeof store.import>[0];
            };
          },
        ) => ({
          id,
          event: {
            type: 'result',
            library:
              request.action === 'presets-read'
                ? store.read()
                : request.action === 'presets-import'
                  ? store.import(request.presets)
                  : store.save(request.revision, request.presets),
          },
        }),
      },
    });
    const source = structuredClone(DEFAULT_SETTINGS);
    source.configuration!.presets[0] = {
      id: 'preset-current',
      name: 'Current',
      provider: 'chatgpt-plan',
      model: 'fixture',
      accountId: 'local-account',
      effort: 'low',
      fast: true,
    };
    source.activeProvider = 'chatgpt-plan';
    source.chatgptPlan = {
      accountId: 'local-account',
      model: 'fixture',
      effort: 'low',
      fast: true,
    };
    let stored = source;
    const owner = createSettingsOwner(
      {
        read: async () => structuredClone(stored),
        write: async (values) => {
          stored = structuredClone(values[SETTINGS_STORAGE_KEY]) as typeof source;
        },
      },
      sharedPresets,
    );
    const first = await owner({ action: 'read' });
    if (first.state !== 'ready') throw new Error('Settings unavailable');
    const migrated = first.settings.configuration!.presets[0]!;
    expect(migrated.id).not.toBe('preset-current');
    expect(first.settings.configuration!.recipes[0]!.presetId).toBe(migrated.id);
    expect(store.read().presets[0]).not.toHaveProperty('accountId');
    const otherApp = store.read();
    otherApp.presets[0]!.name = 'Changed in EZ';
    otherApp.presets[0]!.fast = false;
    store.save(otherApp.revision, otherApp.presets);
    expect(
      (await owner({ action: 'commit', baseline: first.revision, settings: first.settings })).state,
    ).toBe('conflict');
    const second = await owner({ action: 'read' });
    if (second.state !== 'ready') throw new Error('Settings unavailable');
    expect(second.settings.configuration!.presets[0]).toMatchObject({
      name: 'Changed in EZ',
      accountId: 'local-account',
      fast: false,
    });
    second.settings.configuration!.presets[0]!.effort = 'high';
    expect(
      (await owner({ action: 'commit', baseline: second.revision, settings: second.settings }))
        .state,
    ).toBe('ready');
    expect(store.read().presets[0]!.effort).toBe('high');
    expect(JSON.parse(readFileSync(store.path, 'utf8')).appearance).toEqual({ theme: 'dark' });
    const current = store.read();
    store.save(current.revision, []);
    expect((await sharedPresets.load(stored)).configuration!.presets).toEqual([]);
    stored = structuredClone(source);
    Object.assign(stored.configuration!, { schemaVersion: 999 });
    const invalid = await owner({ action: 'read' });
    if (invalid.state !== 'invalid') throw new Error('Invalid settings were accepted');
    const reset = await owner({ action: 'reset', baseline: invalid.revision });
    if (reset.state !== 'ready') throw new Error('Reset failed');
    expect(
      (await owner({ action: 'commit', baseline: reset.revision, settings: reset.settings })).state,
    ).toBe('ready');
    vi.stubGlobal('chrome', {
      runtime: {
        sendNativeMessage: vi.fn(async () => {
          throw new Error('Helper unavailable');
        }),
      },
    });
    const localOnly = await sharedPresets.load({ ...DEFAULT_SETTINGS, sharedPresetRevision: 7 });
    expect(localOnly.sharedPresetRevision).toBeUndefined();
    await expect(sharedPresets.save(localOnly)).resolves.toEqual(DEFAULT_SETTINGS);
  } finally {
    vi.unstubAllGlobals();
    rmSync(directory, { recursive: true, force: true });
  }
});
