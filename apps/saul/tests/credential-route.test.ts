import { afterEach, expect, it, vi } from 'vitest';
import { readCredentialRoute } from '../src/providers/credential-route';
afterEach(() => vi.unstubAllGlobals());
it('reads only the route and never rewrites even an obsolete configuration', async () => {
  const set = vi.fn();
  const get = vi
    .fn()
    .mockResolvedValue({ saul_user_settings: { providers: [], sharedCredentials: 'saul' } });
  vi.stubGlobal('chrome', { storage: { local: { get, set } } });
  expect(await readCredentialRoute()).toBe('saul');
  expect(set).not.toHaveBeenCalled();
  get.mockResolvedValue({ saul_user_settings: { sharedCredentials: 'unexpected' } });
  await expect(readCredentialRoute()).rejects.toThrow('Cannot resolve');
  expect(set).not.toHaveBeenCalled();
});
it('uses the validated runtime route without storage access and propagates missing replies', async () => {
  const sendMessage = vi.fn().mockResolvedValue({ success: true, result: { mode: 'standalone' } });
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  expect(await readCredentialRoute()).toBe('local');
  sendMessage.mockResolvedValue(undefined);
  await expect(readCredentialRoute()).rejects.toThrow('Cannot resolve');
  expect(sendMessage).toHaveBeenCalledTimes(2);
});
