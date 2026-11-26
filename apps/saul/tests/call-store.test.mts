import { storagePort } from './helpers/storage-port';
import { afterEach, expect, it, vi } from 'vitest';
import { createCustomActionStore } from '../src/custom-actions/store';
import { LEGACY_CALL_STATE_KEY } from '../src/custom-actions/contract';

afterEach(() => vi.unstubAllGlobals());

it('exposes only approved library entries to other features', async () => {
  const revision = {
    revision: 'a'.repeat(64),
    contractVersion: 1 as const,
    name: 'Review',
    description: 'Review the page',
    language: 'typescript' as const,
    source: 'export default () => "review";',
    createdAt: 1,
  };
  const approved = { revision: { ...revision, approved: true }, presetId: 'preset-a' };
  const candidate = {
    revision: { ...revision, revision: 'b'.repeat(64), approved: false },
    presetId: 'preset-b',
  };
  const value = {
    schema: 2,
    library: [candidate, approved],
    selected: candidate.revision.revision + ':' + candidate.presetId,
    builtinPresetId: 'builtin',
  };
  vi.stubGlobal('chrome', {
    storage: { local: { get: async () => ({ saul_call_choices_v1: { revision: 2, value } }) } },
  });
  const storage = createCustomActionStore();
  await expect(storage.readLibrary()).resolves.toEqual([approved]);
  await expect(storage.readChoices()).resolves.toMatchObject({
    choices: { selected: candidate, builtinPresetId: 'builtin' },
  });
});

it('adopts the JSON call library and refuses helper loss or stale saves after adoption', async () => {
  const local: Record<string, unknown> = { [LEGACY_CALL_STATE_KEY]: {} };
  let revision = 1;
  let available = false;
  let sharedValue: unknown = { library: [] };
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (keys: string | string[]) =>
          Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, local[key]])),
        set: async (values: Record<string, unknown>) => Object.assign(local, values),
      },
    },
    runtime: {
      connectNative: storagePort(
        async (
          _: string,
          { request }: { request: { action: string; revision: number; value: unknown } },
        ) => {
          if (!available) throw new Error('Disconnected');
          if (request.action === 'config-read')
            return { event: { type: 'result', config: { revision, value: sharedValue } } };
          if (request.revision !== revision)
            return { event: { type: 'error', message: 'Scoped settings changed. Reload.' } };
          sharedValue = request.value;
          return {
            event: { type: 'result', config: { revision: ++revision, value: sharedValue } },
          };
        },
      ),
    },
  });
  const storage = createCustomActionStore();
  const localBeforeAdoption = await storage.readChoices();
  expect(localBeforeAdoption.source).toEqual({ kind: 'chrome', revision: 0 });
  available = true;
  const first = await storage.readChoices();
  expect(first).toMatchObject({ state: 'ready', choices: { library: [] } });
  expect(local.saul_calls_unified).toBe(true);
  await expect(storage.saveChoices(localBeforeAdoption.source, { library: [] })).rejects.toThrow(
    'Reload',
  );
  expect(local.saul_call_choices_v1).toBeUndefined();
  revision++;
  await expect(storage.saveChoices(first.source, { library: [] })).rejects.toThrow('Reload');
  expect(local[LEGACY_CALL_STATE_KEY]).toEqual({});
  available = false;
  await expect(createCustomActionStore().readChoices()).rejects.toThrow('unavailable');
});
it('allows browser-only storage but rejects malformed replies rather than downgrading', async () => {
  const sendNativeMessage = vi.fn(async (): Promise<unknown> => {
    throw new Error('Not installed');
  });
  vi.stubGlobal('chrome', {
    storage: { local: { get: async () => ({}), set: vi.fn() } },
    runtime: { connectNative: storagePort(sendNativeMessage) },
  });
  expect(await createCustomActionStore().readChoices()).toMatchObject({
    state: 'ready',
    source: { kind: 'chrome' },
  });
  sendNativeMessage.mockResolvedValue({ event: { type: 'result', config: { revision: -1 } } });
  await expect(createCustomActionStore().readChoices()).rejects.toThrow('invalid reply');
});

it('migrates a legacy built-in reference once and rejects stale local choice saves', async () => {
  const local: Record<string, unknown> = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (keys: string | string[]) =>
          Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, local[key]])),
        set: async (values: Record<string, unknown>) => Object.assign(local, values),
      },
    },
  });
  const readLegacyPresetId = vi.fn(async () => 'removed-preset');
  const storage = createCustomActionStore(readLegacyPresetId);
  const migrated = await storage.readChoices();
  expect(migrated).toMatchObject({
    state: 'ready',
    choices: { builtinPresetId: 'removed-preset', library: [] },
  });
  await storage.saveChoices(migrated.source, { builtinPresetId: 'chosen-preset' });
  await expect(
    storage.saveChoices(migrated.source, { builtinPresetId: 'stale-preset' }),
  ).rejects.toThrow('Reload');
  expect(await createCustomActionStore(readLegacyPresetId).readChoices()).toMatchObject({
    state: 'ready',
    choices: { builtinPresetId: 'chosen-preset' },
  });
  expect(readLegacyPresetId).toHaveBeenCalledTimes(1);
});

it('preserves a concurrent shared Calls save when migrating from the old shape', async () => {
  const local: Record<string, unknown> = {};
  let revision = 3;
  let value: unknown = { library: [] };
  const write = vi.fn();
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (keys: string | string[]) =>
          Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, local[key]])),
        set: async (values: Record<string, unknown>) => Object.assign(local, values),
      },
    },
    runtime: {
      connectNative: storagePort(
        async (_host: string, { request }: { request: { action: string; revision: number } }) => {
          if (request.action === 'config-read')
            return { event: { type: 'result', config: { revision, value } } };
          write(request);
          expect(request.revision).toBeLessThan(revision);
          return { event: { type: 'error', message: 'Scoped settings changed. Reload.' } };
        },
      ),
    },
  });
  const readLegacyPresetId = vi.fn(async () => {
    revision++;
    value = { schema: 2, library: [], builtinPresetId: 'selected-elsewhere' };
    return 'old-preset';
  });
  const storage = createCustomActionStore(readLegacyPresetId);
  await expect(storage.readChoices()).rejects.toThrow('Reload');
  expect(await storage.readChoices()).toMatchObject({
    state: 'ready',
    choices: { builtinPresetId: 'selected-elsewhere' },
  });
  expect(readLegacyPresetId).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenCalledTimes(1);
});

it('reads back an uncertain migration and never falls back after the shared section was adopted', async () => {
  const local: Record<string, unknown> = {};
  let config: { revision: number; value?: unknown } = { revision: 0 };
  const write = vi.fn();
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (keys: string | string[]) =>
          Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, local[key]])),
        set: async (values: Record<string, unknown>) => Object.assign(local, values),
      },
    },
    runtime: {
      connectNative: storagePort(
        async (_host: string, { request }: { request: { action: string; value: unknown } }) => {
          if (request.action === 'config-read') return { event: { type: 'result', config } };
          write(request);
          config = { revision: config.revision + 1, value: request.value };
          throw new Error('Disconnected after applying save');
        },
      ),
    },
  });
  const readLegacyPresetId = vi.fn(async () => 'old');
  const storage = createCustomActionStore(readLegacyPresetId);
  await expect(storage.readChoices()).rejects.toThrow('Could not confirm');
  expect(local.saul_calls_unified).toBe('pending');
  expect(await storage.readChoices()).toMatchObject({
    state: 'ready',
    choices: { builtinPresetId: 'old' },
  });
  expect(local.saul_calls_unified).toBe(true);
  expect(await storage.migrationComplete()).toBe(true);
  config = { revision: config.revision + 1 };
  expect(await storage.readChoices()).toMatchObject({
    state: 'ready',
    choices: { library: [] },
  });
  expect(await storage.migrationComplete()).toBe(true);
  expect(readLegacyPresetId).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenCalledTimes(1);
});

it('promotes the Chrome selection before exposing the available shared scope', async () => {
  const local: Record<string, unknown> = {};
  let available = false;
  let config: { revision: number; value?: unknown } = { revision: 0 };
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (keys: string | string[]) =>
          Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, local[key]])),
        set: async (values: Record<string, unknown>) => Object.assign(local, values),
      },
    },
    runtime: {
      connectNative: storagePort(
        async (
          _host: string,
          { request }: { request: { action: string; revision: number; value: unknown } },
        ) => {
          if (!available) throw new Error('Disconnected');
          if (request.action === 'config-save') {
            expect(request.revision).toBe(0);
            config = { revision: 1, value: request.value };
          }
          return { event: { type: 'result', config } };
        },
      ),
    },
  });
  const storage = createCustomActionStore();
  const first = await storage.readChoices();
  await storage.saveChoices(first.source, { builtinPresetId: 'kept' });
  const chromeChoice = await storage.readChoices();
  available = true;
  expect(await storage.readChoices()).toMatchObject({
    state: 'ready',
    source: { kind: 'shared', revision: 1 },
    choices: { builtinPresetId: 'kept' },
  });
  await expect(
    storage.saveChoices(chromeChoice.source, { builtinPresetId: 'stale' }),
  ).rejects.toThrow('Reload');
  expect(await storage.migrationComplete()).toBe(true);
});
