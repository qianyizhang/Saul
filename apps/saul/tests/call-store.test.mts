import { storagePort } from './helpers/storage-port';
import { afterEach, expect, it, vi } from 'vitest';
import { createCallStore } from '../src/calls/store';
import { LEGACY_CALL_STATE_KEY } from '../src/calls/contract';
import { DEFAULT_CONFIGURATION } from '../src/configuration/definition';

afterEach(() => vi.unstubAllGlobals());
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
  const storage = createCallStore();
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
  await expect(createCallStore().readChoices()).rejects.toThrow('unavailable');
});
it('allows browser-only storage but rejects malformed replies rather than downgrading', async () => {
  const sendNativeMessage = vi.fn(async (): Promise<unknown> => {
    throw new Error('Not installed');
  });
  vi.stubGlobal('chrome', {
    storage: { local: { get: async () => ({}), set: vi.fn() } },
    runtime: { connectNative: storagePort(sendNativeMessage) },
  });
  expect(await createCallStore().readChoices()).toMatchObject({
    state: 'ready',
    source: { kind: 'chrome' },
  });
  sendNativeMessage.mockResolvedValue({ event: { type: 'result', config: { revision: -1 } } });
  await expect(createCallStore().readChoices()).rejects.toThrow('invalid reply');
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
  const readSettings = vi.fn(async () => ({
    ...DEFAULT_CONFIGURATION,
    summaryPresetId: 'removed-preset',
  }));
  const storage = createCallStore();
  const migrated = await storage.readChoices(readSettings);
  expect(migrated).toMatchObject({
    state: 'ready',
    choices: { builtinPresetId: 'removed-preset', library: [] },
  });
  await storage.saveChoices(migrated.source, { builtinPresetId: 'chosen-preset' });
  await expect(
    storage.saveChoices(migrated.source, { builtinPresetId: 'stale-preset' }),
  ).rejects.toThrow('Reload');
  expect(await createCallStore().readChoices(readSettings)).toMatchObject({
    state: 'ready',
    choices: { builtinPresetId: 'chosen-preset' },
  });
  expect(readSettings).toHaveBeenCalledTimes(1);
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
  const readSettings = vi.fn(async () => {
    revision++;
    value = { schema: 2, library: [], builtinPresetId: 'selected-elsewhere' };
    return { ...DEFAULT_CONFIGURATION, summaryPresetId: 'old-preset' };
  });
  const storage = createCallStore();
  await expect(storage.readChoices(readSettings)).rejects.toThrow('Reload');
  expect(await storage.readChoices(readSettings)).toMatchObject({
    state: 'ready',
    choices: { builtinPresetId: 'selected-elsewhere' },
  });
  expect(readSettings).toHaveBeenCalledTimes(1);
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
  const readSettings = vi.fn(async () => ({ ...DEFAULT_CONFIGURATION, summaryPresetId: 'old' }));
  const storage = createCallStore();
  await expect(storage.readChoices(readSettings)).rejects.toThrow('Could not confirm');
  expect(local.saul_calls_unified).toBe('pending');
  expect(await storage.readChoices(readSettings)).toMatchObject({
    state: 'ready',
    choices: { builtinPresetId: 'old' },
  });
  expect(local.saul_calls_unified).toBe(true);
  expect(await storage.migrationComplete()).toBe(true);
  config = { revision: config.revision + 1 };
  expect(await storage.readChoices(readSettings)).toMatchObject({
    state: 'ready',
    choices: { library: [] },
  });
  expect(await storage.migrationComplete()).toBe(true);
  expect(readSettings).toHaveBeenCalledTimes(1);
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
  const storage = createCallStore();
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
