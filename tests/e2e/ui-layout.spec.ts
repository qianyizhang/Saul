import { test, expect } from './fixtures.ts';
import { configureFixtureProvider } from './support.ts';

test('compact workspace supports reading, tab controls and reachable settings', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { popup, context } = await sandbox.launch();
  await popup.setViewportSize({ width: 440, height: 600 });
  await expect(popup.getByRole('button', { name: 'Reading history', exact: true })).toBeVisible();
  await expect(popup.getByText('No highlights recorded yet.')).toBeVisible();
  await popup.screenshot({ path: info.outputPath('01-reading.png'), fullPage: true });
  await configureFixtureProvider(popup, fixtureServer.origin);
  const article = await context.newPage();
  await article.goto(fixtureServer.origin + '/article');
  await expect(article.locator('saul-root')).toBeAttached();
  await article.locator('#concept').click({ clickCount: 3 });
  await article.getByRole('button', { name: 'Explain', exact: true }).click();
  await article.getByRole('button', { name: 'View', exact: true }).click();
  await expect(article.getByRole('button', { name: 'Regenerate', exact: true })).toBeVisible();
  await article.screenshot({ path: info.outputPath('02-explanation.png') });
  await popup.getByRole('button', { name: 'Reading history', exact: true }).click();
  await expect(popup.locator('.history-title')).toHaveCount(1);
  await popup.locator('.history-title').click();
  await popup.screenshot({ path: info.outputPath('03-history.png'), fullPage: true });
  await popup.getByRole('button', { name: 'Tabs', exact: true }).click();
  await expect(popup.locator('.tab-row').first()).toBeVisible();
  await expect(popup.getByLabel('Codex tab access')).toBeHidden();
  await expect(popup.getByRole('button', { name: 'Preview group', exact: true })).toHaveCount(0);
  await popup.screenshot({ path: info.outputPath('04-tabs.png'), fullPage: true });
  await popup
    .getByRole('checkbox', { name: 'Select Calculus reading fixture', exact: true })
    .check();
  await expect(popup.getByRole('button', { name: 'Preview group', exact: true })).toBeEnabled();
  const connection = popup.locator('summary').filter({ hasText: /^Codex connection$/ });
  await connection.focus();
  await popup.keyboard.press('Enter');
  await expect(popup.getByLabel('Codex tab access')).toBeVisible();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(popup.getByLabel('Provider', { exact: true })).toBeVisible();
  const save = popup.getByRole('button', { name: 'Save Settings', exact: true });
  await expect(save).toBeInViewport();
  await popup.screenshot({ path: info.outputPath('05-settings.png') });
  await popup.getByLabel('Model name', { exact: true }).fill('');
  await save.click();
  await expect(popup.getByRole('alert')).toBeInViewport();
  await popup.getByLabel('Model name', { exact: true }).fill('changed-model');
  popup.once('dialog', (dialog) => dialog.dismiss());
  await popup.getByRole('button', { name: 'Tabs', exact: true }).click();
  await expect(popup.getByLabel('Model name', { exact: true })).toHaveValue('changed-model');
  await save.click();
  await expect(popup.getByRole('button', { name: 'Saved!', exact: true })).toBeVisible();
  await popup.reload();
  await expect(popup.getByLabel('Model name', { exact: true })).toHaveValue('changed-model');
  for (const width of [360, 440, 1000]) {
    await popup.setViewportSize({ width, height: 600 });
    await popup.getByRole('button', { name: 'Reading history', exact: true }).click();
    await expect(popup.locator('.history-title')).toHaveCount(1);
    expect(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await popup.goto(popup.url().replace('popup.html', 'library.html'));
  await expect(popup.locator('.history-title')).toHaveCount(1);
  await popup.screenshot({ path: info.outputPath('06-full-workspace.png') });
});
