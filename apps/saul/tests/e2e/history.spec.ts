import { test, expect } from './fixtures.ts';
import { configureFixtureProvider, createFixtureServer } from './support.ts';
import { explainSelection } from './driver.ts';
import { seedPersistedHistory } from './database-harness.ts';

test.use({ databaseFixtures: true });

test('deleting a saved passage updates its page and clearing history survives restart', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const browser = await sandbox.launch();
  const { context, popup } = browser;
  await configureFixtureProvider(popup, fixtureServer.origin);

  const article = await context.newPage();
  await article.goto(fixtureServer.origin + '/article');
  await expect(article.locator('saul-root')).toBeAttached();
  await article.locator('#concept').click({ clickCount: 3 });
  await article.getByRole('button', { name: 'Explain & open', exact: true }).click();
  await expect(article.getByRole('region', { name: 'Saul explanation' })).toBeVisible();
  await expect(article.getByText('Saved', { exact: true })).toBeVisible();

  await popup.getByRole('button', { name: 'History', exact: true }).click();
  await popup.locator('.history-title').click();
  await popup.locator('.history-more > summary').click();
  await popup.getByRole('button', { name: 'Delete highlight' }).click();
  await expect(popup.getByText('No highlights recorded yet.')).toBeVisible();
  await expect(article.getByRole('region', { name: 'Saul explanation' })).toHaveCount(0);

  await popup.getByRole('button', { name: 'Recently deleted', exact: true }).click();
  const deleted = popup.locator('.history-entry');
  await expect(deleted).toHaveCount(1);
  await expect(deleted.getByRole('button', { name: 'Restore', exact: true })).toBeVisible();
  await popup.screenshot({ path: info.outputPath('recently-deleted.png') });
  await popup.setViewportSize({ width: 360, height: 650 });
  await popup.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => popup.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  await popup.screenshot({ path: info.outputPath('recently-deleted-dark-narrow.png') });
  const restore = deleted.getByRole('button', { name: 'Restore', exact: true });
  await restore.focus();
  await expect(restore).toBeFocused();
  await restore.press('Enter');
  await expect(popup.getByText('No recently deleted records.')).toBeVisible();
  await popup.getByRole('button', { name: 'Passages', exact: true }).click();
  await expect(popup.locator('.history-title')).toHaveCount(1);
  await popup.locator('.history-title').click();
  await popup.locator('.history-more > summary').click();
  await popup.getByRole('button', { name: 'Delete highlight' }).click();
  await expect(popup.getByText('No highlights recorded yet.')).toBeVisible();

  const workspace = await context.newPage();
  await workspace.goto(
    popup.url().replace('popup.html', 'library.html').replace(/#.*$/, '') + '#recently-deleted',
  );
  await expect(workspace.locator('.history-entry')).toHaveCount(1);
  workspace.once('dialog', (dialog) => dialog.accept());
  await workspace.getByRole('button', { name: 'Delete permanently', exact: true }).click();
  await expect(workspace.getByText('No recently deleted records.')).toBeVisible();

  await seedPersistedHistory(browser, fixtureServer.origin + '/seeded-history', 2);
  await popup.reload();
  const sample = popup.locator('.history-entry').first();
  await sample.locator('.history-title').click();
  await sample.locator('.history-more > summary').click();
  await sample.getByRole('button', { name: 'Delete highlight' }).click();
  await expect(popup.locator('.history-entry')).toHaveCount(1);
  await popup.getByLabel('Export and manage history', { exact: true }).click();
  popup.once('dialog', (dialog) => dialog.accept());
  await popup.getByRole('button', { name: 'Clear History', exact: true }).click();
  await expect(popup.getByText('No highlights recorded yet.')).toBeVisible();

  const restarted = await sandbox.launch();
  await restarted.popup.getByRole('button', { name: 'History', exact: true }).click();
  await expect(restarted.popup.getByText('No highlights recorded yet.')).toBeVisible();
  await restarted.popup.getByRole('button', { name: 'Recently deleted', exact: true }).click();
  await expect(restarted.popup.getByText('No recently deleted records.')).toBeVisible();
});

test('Stop and delete settles active reading before moving it out of Passages', async ({
  sandbox,
}) => {
  const server = await createFixtureServer('Partial answer', { gated: true });
  try {
    const { context, popup } = await sandbox.launch();
    await configureFixtureProvider(popup, server.origin);
    const article = await context.newPage();
    await article.goto(server.origin + '/article');
    await explainSelection(article);
    await expect(article.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await popup.getByRole('button', { name: 'History', exact: true }).click();
    await popup.locator('.history-title').click();
    await popup.locator('.history-more > summary').click();
    await popup.getByRole('button', { name: 'Stop and delete', exact: true }).click();
    await expect(popup.getByText('No highlights recorded yet.')).toBeVisible();
    await expect(article.getByRole('region', { name: 'Saul explanation' })).toHaveCount(0);
    await popup.getByRole('button', { name: 'Recently deleted', exact: true }).click();
    await expect(popup.getByRole('button', { name: 'Restore', exact: true })).toBeVisible();
    expect(server.requests).toHaveLength(1);
  } finally {
    await server.close();
  }
});
