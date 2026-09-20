import { test, expect } from './fixtures.ts';
import { answer, configureFixtureProvider, seedHistory } from './support.ts';
import { readFile } from 'node:fs/promises';

test('library search, export, source navigation and explicit deletion', async ({
  sandbox,
  fixtureServer,
}) => {
  const browser = await sandbox.launch(),
    { context, popup } = browser;
  await configureFixtureProvider(popup, fixtureServer.origin);
  const article = await context.newPage();
  await article.goto(fixtureServer.origin + '/article');
  await expect(article.locator('saul-root')).toBeAttached();
  await article.locator('#concept').click({ clickCount: 3 });
  await article.getByRole('button', { name: 'Explain', exact: true }).click();
  await expect(article.getByText('Explanation ready', { exact: true })).toBeVisible();
  await popup.getByRole('button', { name: 'Reading history', exact: true }).click();
  await expect(popup.locator('.history-title')).toContainText('Gradient descent');
  await popup.getByPlaceholder('Search reading history').fill('unmatchedword');
  await expect(popup.getByText('No matching highlights.')).toBeVisible();
  await popup.getByPlaceholder('Search reading history').fill('Grad');
  await expect(popup.locator('.history-title')).toContainText('Gradient descent');
  await popup.locator('.history-title').click();
  await expect(popup.getByText(answer, { exact: true })).toBeVisible();
  const download = popup.waitForEvent('download');
  await popup.getByRole('button', { name: 'Export to Markdown' }).click();
  expect(await readFile((await (await download).path())!, 'utf8')).toContain(answer);
  await popup.getByTitle('View source and explanation').click();
  await expect(article.getByRole('region', { name: 'Saul explanation' })).toBeVisible();
  expect(context.pages().filter((p) => p.url() === article.url())).toHaveLength(1);
  await popup.getByPlaceholder('Search reading history').fill('');
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
