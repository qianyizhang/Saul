import { settingsSection } from './driver.ts';
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

test('History Read gates both tools on every call and can be revoked', async ({}, info) => {
  const sandbox = await createSandbox({
    databaseFixtures: true,
    browserToolsFixtures: true,
    artifactsDir: info.outputPath('browser'),
  });
  let failed = true;
  try {
    const { popup } = await sandbox.launch();
    const id = 'ez:' + (await runDatabaseFixture<string>(popup, { action: 'seed-native' }));
    const call = (tool: string, request: Record<string, string>) =>
      popup.evaluate(
        ({ tool, request }) =>
          chrome.runtime.sendMessage({ target: 'saul-fixture-history-bridge', tool, request }),
        { tool, request },
      );
    const search = () => call('saul_history_search', { query: 'Shared native' });
    const read = () => call('saul_history_read', { id });
    expect((await read()).error).toContain('Local tool access');
    await popup.getByRole('button', { name: 'Settings', exact: true }).click();
    await settingsSection(popup, 'Preferences');
    await popup
      .locator('summary')
      .filter({ hasText: /^Integrations$/ })
      .click();
    const master = popup.getByRole('checkbox', { name: 'Local tool access', exact: true });
    const history = popup.getByRole('checkbox', { name: /History Read/ });
    await expect(history).toBeDisabled();
    await master.check();
    await expect(history).not.toBeChecked();
    expect((await search()).error).toContain('Enable History Read');
    expect((await read()).error).toContain('Enable History Read');
    await history.check();
    await expect
      .poll(async () => (await search()).result?.items)
      .toMatchObject([{ id, source: 'ez' }]);
    expect((await read()).result).toMatchObject({
      id,
      source: 'ez',
      prompt: 'Frozen native prompt',
      answer: 'Shared native answer 你好',
    });
    await history.uncheck();
    await expect.poll(async () => (await read()).error).toContain('Enable History Read');
    failed = false;
  } finally {
    await sandbox.close(failed);
  }
});
