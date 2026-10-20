import { afterEach, expect, it, vi } from 'vitest';
import { handleTabCall } from '../src/native/tabs';

function setup({
  enabled = true,
  url = 'https://example.com/',
  incognito = false,
  pendingUrl = '',
} = {}) {
  const browser = {
    storage: { local: { get: vi.fn(async () => ({ saul_native_page_enabled: enabled })) } },
    tabs: {
      get: vi.fn(async () => ({ windowId: 1, url, incognito, pendingUrl })),
      update: vi.fn(),
    },
    windows: { get: vi.fn(async () => ({ type: 'normal', incognito: false })) },
    scripting: {
      executeScript: vi.fn(async () => [
        { documentId: 'doc', result: { error: 'Page reference is stale; read the page again' } },
      ]),
    },
  };
  vi.stubGlobal('chrome', browser);
  return browser;
}
afterEach(() => vi.unstubAllGlobals());
it('blocks page access before reading tab details when disabled', async () => {
  const browser = setup({ enabled: false });
  await expect(handleTabCall('saul_page_read', { tabId: 1 })).rejects.toThrow(
    'Enable Page reading',
  );
  expect(browser.tabs.get).not.toHaveBeenCalled();
});
it('rejects private, internal, credential-bearing and navigating pages without injection', async () => {
  for (const options of [
    { incognito: true },
    { url: 'chrome://settings/' },
    { url: 'https://user:pass@example.com/' },
    { pendingUrl: 'https://example.com/next' },
  ]) {
    const browser = setup(options);
    await expect(handleTabCall('saul_page_read', { tabId: 1 })).rejects.toThrow();
    expect(browser.scripting.executeScript).not.toHaveBeenCalled();
  }
});
it('propagates actionable document errors and targets the read document for actions', async () => {
  const browser = setup();
  await expect(
    handleTabCall('saul_page_act', {
      tabId: 1,
      documentId: 'doc',
      snapshotId: 'snapshot',
      elementId: 0,
      action: 'click',
    }),
  ).rejects.toThrow('Page reference is stale');
  expect(browser.scripting.executeScript).toHaveBeenCalledWith(
    expect.objectContaining({ target: { tabId: 1, documentIds: ['doc'] }, world: 'ISOLATED' }),
  );
});
it('previews navigation and refuses changed source URLs before updating a tab', async () => {
  const browser = setup();
  const args = { tabId: 1, expectedUrl: 'https://example.com/', url: 'https://example.com/next' };
  expect(await handleTabCall('saul_page_navigate', args)).toMatchObject({ dryRun: true });
  expect(browser.tabs.update).not.toHaveBeenCalled();
  await expect(
    handleTabCall('saul_page_navigate', {
      ...args,
      expectedUrl: 'https://wrong.example/',
      dryRun: false,
    }),
  ).rejects.toThrow('URL changed');
  expect(browser.tabs.update).not.toHaveBeenCalled();
  await handleTabCall('saul_page_navigate', { ...args, dryRun: false });
  expect(browser.tabs.update).toHaveBeenCalledWith(1, { url: args.url });
});
