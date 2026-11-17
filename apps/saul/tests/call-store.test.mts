import { afterEach, expect, it, vi } from 'vitest';
import { createCallStore } from '../src/calls/store';
import { LEGACY_CALL_STATE_KEY } from '../src/calls/contract';

afterEach(() => vi.unstubAllGlobals());
it('adopts the JSON call library and refuses helper loss or stale saves after adoption', async () => {
  const local: Record<string, unknown> = { [LEGACY_CALL_STATE_KEY]: {} };
  let revision = 1;
  let available = false;
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (keys: string | string[]) =>
          Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, local[key]])),
        set: async (values: Record<string, unknown>) => Object.assign(local, values),
      },
    },
    runtime: {
      sendNativeMessage: async (
        _: string,
        { request }: { request: { action: string; revision: number; value: unknown } },
      ) => {
        if (!available) throw new Error('Disconnected');
        if (request.action === 'config-read')
          return { event: { type: 'result', config: { revision, value: { library: [] } } } };
        if (request.revision !== revision)
          return { event: { type: 'error', message: 'Scoped settings changed. Reload.' } };
        return {
          event: { type: 'result', config: { revision: ++revision, value: request.value } },
        };
      },
    },
  });
  const storage = createCallStore();
  const localBeforeAdoption = await storage.readChoices();
  expect(localBeforeAdoption.source).toEqual({ kind: 'chrome' });
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
    runtime: { sendNativeMessage },
  });
  expect(await createCallStore().readChoices()).toMatchObject({
    state: 'ready',
    source: { kind: 'chrome' },
  });
  sendNativeMessage.mockResolvedValue({ event: { type: 'result', config: { revision: -1 } } });
  await expect(createCallStore().readChoices()).rejects.toThrow('invalid reply');
});
