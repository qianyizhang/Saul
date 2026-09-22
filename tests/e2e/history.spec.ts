import { test, expect } from './fixtures.ts';
import { configureFixtureProvider, seedHistory } from './support.ts';

test('deleting a saved passage updates its page and clearing history survives restart', async ({
  sandbox,
  fixtureServer,
}) => {
  const browser = await sandbox.launch();
  const { context, popup } = browser;
  await configureFixtureProvider(popup, fixtureServer.origin);

  const article = await context.newPage();
  await article.goto(fixtureServer.origin + '/article');
  await expect(article.locator('saul-root')).toBeAttached();
  await article.locator('#concept').click({ clickCount: 3 });
  await article.getByRole('button', { name: 'Explain', exact: true }).click();
  await expect(article.getByText('Explanation ready', { exact: true })).toBeVisible();
  await article.getByRole('button', { name: 'View', exact: true }).click();
  await expect(article.getByRole('region', { name: 'Saul explanation' })).toBeVisible();

  await popup.getByRole('button', { name: 'Reading history', exact: true }).click();
  await popup.locator('.history-title').click();
  await popup.getByRole('button', { name: 'Delete highlight' }).click();
  await expect(popup.getByText('No highlights recorded yet.')).toBeVisible();
  await expect(article.getByRole('region', { name: 'Saul explanation' })).toHaveCount(0);

  await seedHistory(browser, fixtureServer.origin, 2);
  await popup.reload();
  popup.once('dialog', (dialog) => dialog.accept());
  await popup.getByRole('button', { name: 'Clear All', exact: true }).click();
  await expect(popup.getByText('No highlights recorded yet.')).toBeVisible();

  const restarted = await sandbox.launch();
  await restarted.popup.getByRole('button', { name: 'Reading history', exact: true }).click();
  await expect(restarted.popup.getByText('No highlights recorded yet.')).toBeVisible();
});
