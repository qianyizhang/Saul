import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.ts';
import { getFirstHistory, getHistory, openFirstPageExplanation, sendDb } from './driver.ts';
import { reviewScreenshots } from './artifacts.ts';

const gif = readFileSync(new URL('../../../../contracts/fixtures/animation.gif', import.meta.url));
test('Illustrate chooses GIF at runtime, saves exact bytes, previews and downloads after restart', async ({
  sandbox,
  fixtureServer,
}, info) => {
  let browser = await sandbox.launch();
  await browser.popup.evaluate(async () => {
    await chrome.storage.local.set({
      saul_user_settings: {
        sharedCredentials: 'saul',
        activeProvider: 'openai-compatible',
        openaiCompatible: {
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          credentialOwner: 'saul',
          model: 'text-fixture',
        },
      },
    });
  });
  await browser.worker.evaluate((encoded) => {
    const original = chrome.runtime.connectNative.bind(chrome.runtime);
    const requests: unknown[] = [];
    Object.assign(globalThis, { illustrationRequests: requests });
    chrome.runtime.connectNative = ((host: string) => {
      if (host !== 'com.saul.credentials') return original(host);
      const listeners: ((message: unknown) => void)[] = [];
      return {
        onMessage: {
          addListener: (listener: (message: unknown) => void) => listeners.push(listener),
        },
        onDisconnect: { addListener: () => {} },
        disconnect: () => {},
        postMessage: (packet: {
          id: string;
          request?: { action: string; [key: string]: unknown };
        }) => {
          if (!packet.request) return;
          const request = packet.request;
          if (request.action === 'api-image') requests.push(request);
          queueMicrotask(() =>
            listeners.forEach((listener) =>
              listener({
                id: packet.id,
                event:
                  request.action === 'api-image'
                    ? { type: 'result', imageBase64: encoded }
                    : { type: 'result', accounts: [], apiConnected: true },
              }),
            ),
          );
        },
      } as unknown as chrome.runtime.Port;
    }) as typeof chrome.runtime.connectNative;
  }, gif.toString('base64'));
  let page = await browser.context.newPage();
  await page.goto(fixtureServer.origin + '/article');
  await expect(page.locator('saul-root')).toBeAttached();
  await page.locator('#concept').click({ clickCount: 3 });
  await page.getByLabel('Action', { exact: true }).selectOption('recipe-illustrate');
  await page.getByLabel('Output format', { exact: true }).selectOption('gif');
  await expect(page.getByRole('button', { name: 'Illustrate', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Illustrate', exact: true }).click();
  await expect
    .poll(async () => (await getHistory(browser.popup))[0]?.latest.status)
    .toBe('completed');
  const item = await getFirstHistory(browser.popup);
  expect(item.hasImage).toBe(true);
  expect(
    await sendDb(browser.popup, {
      type: 'DB_IMAGE',
      payload: { selectionId: item.selectionId, runId: item.latest.id },
    }),
  ).toEqual({ data: gif.toString('base64'), mediaType: 'image/gif' });
  await openFirstPageExplanation(page);
  await expect(page.getByAltText('Generated illustration')).toBeVisible();
  await expect(page.getByLabel('Follow-up question', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Pause animation', exact: true }).click();
  await expect(page.getByAltText('Generated illustration')).toHaveAttribute(
    'src',
    /^data:image\/png/,
  );
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download GIF', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.gif$/);
  if (reviewScreenshots)
    await page.screenshot({ path: info.outputPath('illustrate-gif-light.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.reload();
  await openFirstPageExplanation(page);
  await expect(page.getByRole('button', { name: 'Play animation', exact: true })).toBeVisible();
  if (reviewScreenshots)
    await page.screenshot({ path: info.outputPath('illustrate-gif-narrow-dark.png') });
  const requests = await browser.worker.evaluate(
    () => (globalThis as unknown as { illustrationRequests: unknown[] }).illustrationRequests,
  );
  expect(requests).toEqual([
    expect.objectContaining({
      action: 'api-image',
      model: 'gpt-image-2.6-flare',
      outputFormat: 'gif',
    }),
  ]);
  browser = await sandbox.launch();
  page = await browser.context.newPage();
  await page.goto(fixtureServer.origin + '/article');
  await openFirstPageExplanation(page);
  await expect(page.getByRole('link', { name: 'Download GIF', exact: true })).toBeVisible();
  await browser.popup.getByRole('button', { name: 'History', exact: true }).click();
  await browser.popup.locator('.history-title').first().click();
  await expect(
    browser.popup.getByRole('link', { name: 'Download GIF', exact: true }),
  ).toBeVisible();
});
