import { test, expect } from './fixtures.ts';
import { configureFixtureProvider } from './support.ts';
import type { Page } from '@playwright/test';

async function explain(page: Page) {
  await expect(page.locator('saul-root')).toBeAttached();
  await page.locator('#concept').click({ clickCount: 3 });
  await page.getByRole('button', { name: 'Explain', exact: true }).click();
  // A rejected submission leaves the selected passage available to retry.
  await expect(page.getByRole('button', { name: 'Explain', exact: true })).toBeVisible();
}

test('mute from a toast applies across tabs and restart; Settings can unmute with an invalid API draft', async ({
  sandbox,
  fixtureServer,
}) => {
  let { context, popup } = await sandbox.launch();
  let page = await context.newPage();
  await page.goto(fixtureServer.origin + '/article');
  const other = await context.newPage();
  await other.goto(fixtureServer.origin + '/article');
  await explain(page);
  await expect(page.getByRole('alert')).toContainText('API key is missing');
  await page.getByRole('button', { name: 'Mute error notifications' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await explain(other);
  await expect(other.getByRole('alert')).toHaveCount(0);
  await expect
    .poll(() =>
      popup.evaluate(
        async () =>
          (await chrome.storage.local.get('saul_mute_error_notifications'))
            .saul_mute_error_notifications,
      ),
    )
    .toBe(true);

  ({ context, popup } = await sandbox.launch());
  page = await context.newPage();
  await page.goto(fixtureServer.origin + '/article');
  await explain(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  const toggle = popup.getByRole('checkbox', { name: 'Mute error notifications' });
  await expect(toggle).toBeChecked();
  await popup.getByLabel('Base URL', { exact: true }).fill('invalid endpoint');
  await toggle.uncheck();
  await expect
    .poll(() =>
      popup.evaluate(
        async () =>
          (await chrome.storage.local.get('saul_mute_error_notifications'))
            .saul_mute_error_notifications,
      ),
    )
    .toBe(false);
  await explain(page);
  await expect(page.getByRole('alert')).toContainText('API key is missing');
  await page.getByRole('button', { name: 'Mute error notifications' }).click();
  await expect(toggle).toBeChecked();

  // Muting errors must not hide successful results or alter provider configuration.
  await configureFixtureProvider(popup, fixtureServer.origin);
  await page.locator('#concept').click({ clickCount: 3 });
  await page.getByRole('button', { name: 'Explain', exact: true }).click();
  await expect(page.getByText('Explanation ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Saul explanation' })).toBeVisible();
});

test('no-response error can be muted even while reading storage is unavailable', async ({
  sandbox,
  fixtureServer,
}) => {
  const { context, worker, popup } = await sandbox.launch();
  await worker.evaluate(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime) as (
      message: unknown,
    ) => Promise<unknown>;
    chrome.runtime.sendMessage = (async (message: unknown) => {
      const request = message as { target?: string; message?: { type?: string } };
      if (request.target === 'saul-offscreen' && request.message?.type === 'DB_PAGE')
        return undefined;
      return send(message);
    }) as typeof chrome.runtime.sendMessage;
  });
  const page = await context.newPage();
  await page.goto(fixtureServer.origin + '/article');
  await expect(page.getByRole('alert')).toContainText('Saul did not respond');
  await page.getByRole('button', { name: 'Mute error notifications' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.reload();
  await explain(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await popup.getByRole('checkbox', { name: 'Mute error notifications' }).uncheck();
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Saul did not respond');
});
