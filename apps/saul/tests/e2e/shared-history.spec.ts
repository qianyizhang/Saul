import { test, expect } from '@playwright/test';
import { createSandbox } from './support';
import { runDatabaseFixture } from './database-harness';
test('imports real old OPFS history, removes it after verification and never resurrects deleted records', async ({}, info) => {
  const sandbox = await createSandbox({
    legacyHistoryFixture: true,
    databaseFixtures: true,
    artifactsDir: info.outputPath('browser'),
  });
  let failed = true;
  try {
    const browser = await sandbox.launch();
    let { popup } = browser;
    await popup.evaluate(async () => {
      const reply = await chrome.runtime.sendMessage({
        target: 'saul-workspace',
        message: { type: 'DB_UNREAD' },
      });
      if (!reply.success) throw new Error(reply.error);
    });
    await browser.worker.evaluate(() => chrome.offscreen.closeDocument());
    await popup.goto(popup.url().replace('popup.html', 'history-migration-fixture.html'));
    await popup.evaluate(async () => {
      const worker = new Worker(chrome.runtime.getURL('history-migration-fixture.js'), {
        type: 'module',
      });
      try {
        await new Promise<void>((resolve, reject) => {
          worker.onmessage = ({ data }) =>
            data.success ? resolve() : reject(new Error(data.error));
          worker.onerror = (event) => reject(new Error(event.message));
          worker.postMessage({});
        });
      } finally {
        worker.terminate();
      }
    });
    await runDatabaseFixture(popup, { action: 'reset-migration' });
    ({ popup } = await sandbox.launch());
    await popup.goto(popup.url().replace('popup.html', 'library.html') + '#history');
    await expect(popup.getByRole('alert')).toHaveCount(0);
    await expect(popup.locator('.history-title')).toHaveText(['Original 你好 selection']);
    await popup.getByRole('button', { name: 'Bookmarks', exact: true }).click();
    await expect(popup.locator('.history-entry')).toHaveCount(1);
    expect(
      await popup.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        try {
          await root.getDirectoryHandle('saul-opfs');
          return true;
        } catch {
          return false;
        }
      }),
    ).toBe(false);
    ({ popup } = await sandbox.launch());
    await popup.getByRole('button', { name: 'History', exact: true }).click();
    await expect(popup.locator('.history-title')).toHaveText(['Original 你好 selection']);
    await popup.locator('.history-title').click();
    await popup.locator('.history-more summary').click();
    await popup.getByRole('button', { name: 'Delete highlight', exact: true }).click();
    await expect(popup.locator('.history-entry')).toHaveCount(0);
    ({ popup } = await sandbox.launch());
    await popup.getByRole('button', { name: 'History', exact: true }).click();
    await expect(popup.locator('.history-entry')).toHaveCount(0);
    failed = false;
  } finally {
    await sandbox.close(failed);
  }
});
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
