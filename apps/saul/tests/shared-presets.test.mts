import { it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SharedPresetsStore } from '../native/shared-presets.mts';
import { sharedPresets } from '../src/storage/shared-presets';
import { validatePlanResult } from '../native/plan-protocol.mts';
import { DEFAULT_PROVIDERS, resolveSharedPresets } from '../native/shared-presets-contract.mts';
import {
  createSettingsOwner,
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
} from '../src/storage/settings';

it('normalizes legacy helper replies once while preserving explicit empty providers', () => {
  const request = { action: 'presets-read' } as const;
  const legacy: unknown = { type: 'result', library: { revision: 2, presets: [] } };
  validatePlanResult(request, legacy);
  const resolved = resolveSharedPresets(legacy.library);
  expect(resolved.providers).toEqual(DEFAULT_PROVIDERS);
  resolved.providers[0]!.name = 'Changed locally';
  expect(resolveSharedPresets(legacy.library).providers[0]!.name).toBe('ChatGPT plan');
  const empty: unknown = {
    type: 'result',
    library: { revision: 2, presets: [], providers: [] },
  };
  validatePlanResult(request, empty);
  expect(resolveSharedPresets(empty.library).providers).toEqual([]);
  for (const providers of [null, {}, [{ key: 'invalid' }]])
    expect(() =>
      validatePlanResult(request, {
        type: 'result',
        library: { revision: 2, presets: [], providers },
      }),
    ).toThrow('invalid reply');
});

it('shares edits, migrates once, keeps accounts outside presets, and refuses a stale settings save', async () => {
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
              section: string;
              value: Record<string, unknown>;
              revision: number;
              presetRevision: number;
              presets: Parameters<typeof store.import>[0];
              providers?: Parameters<typeof store.save>[2];
            };
          },
        ) => ({
          id,
          event: {
            type: 'result',
            ...(request.action === 'config-commit'
              ? store.commit(
                  request.section,
                  request.revision,
                  request.value,
                  request.presetRevision,
                  request.presets,
                  request.providers,
                )
              : request.action.startsWith('config-')
                ? {
                    config:
                      request.action === 'config-read'
                        ? store.readScope(request.section)
                        : store.saveScope(request.section, request.revision, request.value),
                  }
                : {
                    library:
                      request.action === 'presets-read'
                        ? store.read()
                        : request.action === 'presets-import'
                          ? store.import(request.presets)
                          : store.save(request.revision, request.presets, request.providers),
                  }),
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
    // Upgrades from the earlier shared-preset migration also persist scope adoption.
    delete stored.scopedConfigRevision;
    await owner({ action: 'read' });
    expect(stored.scopedConfigRevision).toBeGreaterThan(0);
    const scopedDraft = await sharedPresets.load(stored);
    const modelsBeforeConflict = store.read();
    const scope = store.readScope('settings');
    store.saveScope('settings', scope.revision, { ...scope.value, responseLanguage: 'French' });
    await expect(sharedPresets.save(scopedDraft)).rejects.toThrow();
    expect(store.read()).toEqual(modelsBeforeConflict);
    const otherApp = store.read();
    otherApp.presets[0]!.name = 'Changed in EZ';
    otherApp.presets[0]!.fast = false;
    const draw = {
      id: 'c14b29f3-3ec2-4efc-8bed-e05531aef2cb',
      name: 'Illustration',
      model: 'gpt-image-2.5-flare',
      effort: '',
      fast: false,
      providerKey: 'openai-api',
      capability: 'draw' as const,
      imageOptions: { size: '1536x1024', quality: 'medium' },
    };
    otherApp.presets.push(draw);
    store.save(otherApp.revision, otherApp.presets);
    expect(
      (await owner({ action: 'commit', baseline: first.revision, settings: first.settings })).state,
    ).toBe('conflict');
    const second = await owner({ action: 'read' });
    if (second.state !== 'ready') throw new Error('Settings unavailable');
    expect(second.settings.configuration!.presets[0]).toMatchObject({
      name: 'Changed in EZ',
      fast: false,
    });
    second.settings.configuration!.presets[0]!.effort = 'high';
    expect(
      (await owner({ action: 'commit', baseline: second.revision, settings: second.settings }))
        .state,
    ).toBe('ready');
    expect(store.read().presets[0]!.effort).toBe('high');
    expect(store.read().presets.find((p) => p.id === draw.id)).toEqual(draw);
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
    reset.settings.activeProvider = 'openai-compatible';
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

it('preserves typed image definitions and rejects malformed image options', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'saul-typed-presets-'));
  try {
    const store = new SharedPresetsStore(join(directory, 'settings.json'));
    const image = {
      id: 'c14b29f3-3ec2-4efc-8bed-e05531aef2cb',
      name: 'Illustration',
      model: 'gpt-image-2.5-flare',
      effort: '',
      fast: false,
      providerKey: 'openai-api',
      capability: 'draw' as const,
      imageOptions: { size: '1536x1024', quality: 'medium' },
    };
    store.save(0, [image]);
    const library = store.read();
    library.presets.push({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Writing',
      model: 'fixture',
      effort: 'low',
      fast: false,
      providerKey: 'gpt-plan',
      capability: 'write',
    });
    store.save(library.revision, library.presets);
    expect(store.read().presets[0]).toEqual(image);
    const bad = { ...image, imageOptions: { size: '../../escape', quality: 'low' } };
    expect(() => store.save(store.read().revision, [bad])).toThrow();
    expect(store.read().presets[0]).toEqual(image);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('uses the shared provider fixture, preserves definitions on preset-only saves, and rejects invalid changes', async () => {
  const { validateSharedProviders } = await import('../native/shared-presets-contract.mts');
  const { validatePlanRequest } = await import('../native/plan-protocol.mts');
  const fixture = JSON.parse(
    readFileSync(new URL('../../../contracts/fixtures/providers.json', import.meta.url), 'utf8'),
  );
  const directory = mkdtempSync(join(tmpdir(), 'saul-shared-providers-'));
  try {
    const store = new SharedPresetsStore(join(directory, 'settings.json'));
    writeFileSync(
      store.path,
      JSON.stringify({
        modelPresets: { revision: 0, presets: [], future: 'retained' },
        apps: {
          ez: { configuration: { revision: 1, value: { providers: fixture.providers } } },
        },
      }),
    );
    // Native-scoped names migrate into the common owner rather than being replaced with defaults.
    expect(store.read().providers).toEqual(fixture.providers);
    const first = store.save(0, []);
    expect(first.providers).toEqual(fixture.providers);
    const renamed = structuredClone(first.providers!);
    renamed[1]!.name = 'Renamed in Saul';
    const saved = store.save(first.revision, [], renamed);
    expect(store.read().providers?.[1]).toEqual({
      ...fixture.providers[1],
      name: 'Renamed in Saul',
    });
    expect(JSON.parse(readFileSync(store.path, 'utf8')).modelPresets.future).toBe('retained');
    const bytes = readFileSync(store.path, 'utf8');
    expect(() => store.save(first.revision, [], fixture.providers)).toThrow('changed');
    for (const providers of fixture.invalid) {
      expect(() => validateSharedProviders(providers)).toThrow();
      expect(() =>
        validatePlanRequest({
          action: 'presets-save',
          revision: saved.revision,
          presets: [],
          providers,
        }),
      ).toThrow();
      expect(() => store.save(saved.revision, [], providers)).toThrow();
      expect(readFileSync(store.path, 'utf8')).toBe(bytes);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('rejects malformed image options without coercion in shared and app-scoped presets', async () => {
  const { validateSharedPresets } = await import('../native/shared-presets-contract.mts');
  const { normalizeConfiguration } = await import('../src/models/configuration');
  const fixture = JSON.parse(
    readFileSync(
      new URL('../../../contracts/fixtures/image-options.json', import.meta.url),
      'utf8',
    ),
  );
  const preset = {
    id: 'c14b29f3-3ec2-4efc-8bed-e05531aef2cb',
    name: 'Illustration',
    model: 'gpt-image-2.5-flare',
    effort: '',
    fast: false,
    providerKey: 'openai-api',
    capability: 'draw',
  };
  for (const imageOptions of fixture.valid) {
    expect(() => validateSharedPresets([{ ...preset, imageOptions }])).not.toThrow();
  }
  for (const imageOptions of fixture.invalid) {
    expect(() => validateSharedPresets([{ ...preset, imageOptions }])).toThrow();
    const source = structuredClone(DEFAULT_SETTINGS);
    source.configuration!.presets[0] = { ...source.configuration!.presets[0]!, imageOptions };
    expect(() => normalizeConfiguration(source.configuration, source)).toThrow(
      'image preset options',
    );
  }
});

it('round trips Speak presets and rejects malformed speech options without changing saved bytes', async () => {
  const { validateSharedPresets } = await import('../native/shared-presets-contract.mts');
  const { normalizeConfiguration } = await import('../src/models/configuration');
  const fixture = JSON.parse(
    readFileSync(
      new URL('../../../contracts/fixtures/speech-options.json', import.meta.url),
      'utf8',
    ),
  );
  const directory = mkdtempSync(join(tmpdir(), 'saul-shared-speech-'));
  try {
    const store = new SharedPresetsStore(join(directory, 'settings.json'));
    const preset = {
      id: 'c14b29f3-3ec2-4efc-8bed-e05531aef2cb',
      name: 'Speak',
      providerKey: 'openai-api',
      capability: 'speak' as const,
      model: 'gpt-realtime-2.1-mini',
      effort: '',
      fast: false,
    };
    for (const speechOptions of fixture.valid) {
      const value = { ...preset, speechOptions };
      const saved = store.save(store.read().revision, [value]);
      expect(store.read().presets[0]).toEqual(value);
      expect(saved.presets[0]).toEqual(value);
    }
    const bytes = readFileSync(store.path, 'utf8');
    for (const speechOptions of fixture.invalid) {
      expect(() => validateSharedPresets([{ ...preset, speechOptions }])).toThrow();
      expect(() => store.save(store.read().revision, [{ ...preset, speechOptions }])).toThrow();
      expect(readFileSync(store.path, 'utf8')).toBe(bytes);
      const source = structuredClone(DEFAULT_SETTINGS);
      source.configuration!.presets[0] = { ...source.configuration!.presets[0]!, speechOptions };
      expect(() => normalizeConfiguration(source.configuration, source)).toThrow(
        'speech preset options',
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
