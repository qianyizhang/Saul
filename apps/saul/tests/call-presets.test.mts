import { afterEach, expect, it, vi } from 'vitest';
import { callPresetStorage } from '../src/storage/call-presets';
import { ACTION_STATE_KEY } from '../src/actions/contract';

afterEach(() => vi.unstubAllGlobals());
it('adopts the JSON call library and refuses helper loss or stale saves after adoption', async () => {
  const local: Record<string, unknown> = { [ACTION_STATE_KEY]: {} };
  let revision = 1;
  let available = true;
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: local[key] }),
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
  const storage = callPresetStorage();
  expect((await storage.read()).library).toEqual([]);
  expect(local.saul_calls_unified).toBe(true);
  revision++;
  await expect(storage.write({ library: [] })).rejects.toThrow('Reload');
  expect(local[ACTION_STATE_KEY]).toEqual({});
  available = false;
  await expect(callPresetStorage().read()).rejects.toThrow('unavailable');
});
it('allows browser-only storage but rejects malformed replies rather than downgrading', async () => {
  const sendNativeMessage = vi.fn(async (): Promise<unknown> => {
    throw new Error('Not installed');
  });
  vi.stubGlobal('chrome', {
    storage: { local: { get: async () => ({}), set: vi.fn() } },
    runtime: { sendNativeMessage },
  });
  expect(await callPresetStorage().read()).toEqual({});
  sendNativeMessage.mockResolvedValue({ event: { type: 'result', config: { revision: -1 } } });
  await expect(callPresetStorage().read()).rejects.toThrow('invalid reply');
});
