import { test, expect } from '@playwright/test';
import { createSandbox } from './support';
import { runDatabaseFixture } from './database-harness';
test('shows native records in Saul and applies bookmarks and deletion to the shared store', async ({}, info) => {
  const sandbox = await createSandbox({
    databaseFixtures: true,
    artifactsDir: info.outputPath('browser'),
  });
  let failed = true;
  try {
    let { popup } = await sandbox.launch();
    const id = await runDatabaseFixture<string>(popup, { action: 'seed-native' });
    await popup.goto(popup.url().replace('popup.html', 'library.html') + '#history');
    await expect(popup.locator('.history-title')).toHaveText(['Shared native input']);
    await expect(popup.getByText('EZ · Native action', { exact: true })).toBeVisible();
    await popup.getByRole('button', { name: 'Bookmark', exact: true }).click();
    await popup.locator('.history-title').click();
    await expect(popup.getByText('Shared native answer 你好', { exact: true })).toBeVisible();
    const rows = await runDatabaseFixture<{ selectionId: string; bookmarked: boolean }[]>(popup, {
      action: 'db',
      message: { type: 'DB_GET_HISTORY', payload: { bookmarksOnly: true } },
    });
    expect(rows).toMatchObject([{ selectionId: 'ez:' + id, bookmarked: true }]);
    ({ popup } = await sandbox.launch());
    await popup.getByRole('button', { name: 'History', exact: true }).click();
    await popup.locator('.history-title').click();
    await popup.locator('.history-more summary').click();
    await popup.getByRole('button', { name: 'Delete highlight', exact: true }).click();
    expect(
      await runDatabaseFixture(popup, {
        action: 'db',
        message: { type: 'DB_GET_HISTORY', payload: {} },
      }),
    ).toEqual([]);
    failed = false;
  } finally {
    await sandbox.close(failed);
  }
});
