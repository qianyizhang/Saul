import { test, expect } from './fixtures.ts';
import { installDigestProvider } from './digest-fixture.ts';

test('page summary uses the registered action and keeps single-page reading clear', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { worker, context, popup } = await sandbox.launch();
  await installDigestProvider(worker, true);
  // Chrome rejects update if installation did not register this menu ID.
  await worker.evaluate(() => chrome.contextMenus.update('saul-summarize', { enabled: true }));
  const source = await context.newPage();
  await source.goto(fixtureServer.origin + '/article');
  await source.evaluate(() => {
    document.title = 'How gradient descent finds a minimum';
  });
  const sourceTab = await worker.evaluate(
    async (url) => (await chrome.tabs.query({})).find((t) => t.url === url)!,
    source.url(),
  );
  const readerPromise = context.waitForEvent('page');
  if (process.env.SAUL_CONTEXT_MENU_MANUAL) {
    test.setTimeout(180_000);
    console.log('Ready for native context-menu click in disposable Chrome.');
  } else {
    await popup.evaluate(
      (tabId) =>
        chrome.runtime.sendMessage({
          type: 'WORKSPACE_TABS',
          action: 'command',
          method: 'saul_summary_open',
          args: { tabIds: [tabId] },
        }),
      sourceTab.id!,
    );
  }
  const reader = await readerPromise;
  await expect(
    reader.getByRole('heading', { name: 'How gradient descent finds a minimum' }),
  ).toBeVisible();
  await expect(reader.getByRole('status')).toHaveText('Generating summary…');
  await expect(reader.getByRole('link', { name: 'Open source · 127.0.0.1' })).toHaveAttribute(
    'href',
    source.url(),
  );
  const readerTab = await worker.evaluate(
    async (url) => (await chrome.tabs.query({})).find((t) => t.url === url)!,
    reader.url(),
  );
  expect(readerTab.windowId).toBe(sourceTab.windowId);
  expect(readerTab.index).toBe(sourceTab.index + 1);
  expect(readerTab.openerTabId).toBe(sourceTab.id);
  await reader.screenshot({ path: info.outputPath('single-summary-running.png'), fullPage: true });
  await reader.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(reader.getByRole('status')).toHaveText('Summary stopped');
  await worker.evaluate(() => {
    const state = (globalThis as unknown as { digestFixture: { hold: boolean } }).digestFixture;
    state.hold = false;
  });
  await reader.getByRole('button', { name: 'Retry unfinished' }).click();
  await expect(reader.getByRole('status')).toHaveText('Summary ready');
  await expect(reader.getByRole('heading', { level: 3 })).toHaveCount(0);
  await expect(reader.getByText('A concise source-backed finding.', { exact: true })).toHaveCount(
    3,
  );
  await reader.screenshot({ path: info.outputPath('single-summary-ready.png'), fullPage: true });
  const savedUrl = reader.url();
  await source.close();
  await reader.reload();
  await expect(reader.getByRole('status')).toHaveText('Summary ready');
  await reader.setViewportSize({ width: 360, height: 760 });
  await reader.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await reader.screenshot({
    path: info.outputPath('single-summary-dark-narrow.png'),
    fullPage: true,
  });
  expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  await reader.getByRole('link', { name: 'Saved summaries' }).click();
  await expect(
    reader.getByRole('region', { name: 'Saved summaries' }).getByRole('button'),
  ).toHaveCount(1);
  await reader.goto(savedUrl);
  await expect(reader.getByRole('status')).toHaveText('Summary ready');
});

test('single-page setup failure keeps the source and settings recovery visible', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { worker, context, popup } = await sandbox.launch();
  await worker.evaluate(() => {
    chrome.runtime.connectNative = (() => {
      throw new Error('ChatGPT helper is not installed');
    }) as typeof chrome.runtime.connectNative;
  });
  const source = await context.newPage();
  await source.goto(fixtureServer.origin + '/article');
  const tabId = await worker.evaluate(
    async (url) => (await chrome.tabs.query({})).find((t) => t.url === url)!.id!,
    source.url(),
  );
  const readerPromise = context.waitForEvent('page');
  await popup.evaluate(
    (tabId) =>
      chrome.runtime.sendMessage({
        type: 'WORKSPACE_TABS',
        action: 'command',
        method: 'saul_summary_open',
        args: { tabIds: [tabId] },
      }),
    tabId,
  );
  const reader = await readerPromise;
  await expect(reader.getByRole('alert')).toBeVisible();
  await expect(reader.getByRole('link', { name: 'Open Settings' })).toBeVisible();
  await expect(reader.getByRole('heading', { name: 'Calculus reading fixture' })).toBeVisible();
  await reader.screenshot({ path: info.outputPath('single-summary-setup.png'), fullPage: true });
  await reader.getByRole('link', { name: 'Open Settings' }).click();
  await expect(reader).toHaveURL(/#settings$/);
});
