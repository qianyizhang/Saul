import { test, expect } from './fixtures.ts';
import { answer } from './support.ts';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function db(page: Page, message: object): Promise<any> {
  return page.evaluate(
    (message) => chrome.runtime.sendMessage({ target: 'saul-background', message }),
    message,
  );
}
async function history(page: Page) {
  return db(page, { type: 'DB_GET_HISTORY', payload: {} });
}
function record(origin: string, id: string) {
  return {
    type: 'DB_SAVE_RECORD',
    payload: {
      page: { url: `${origin}/article`, title: 'Calculus reading fixture' },
      selection: { id, text: `Gradient ${id}`, createdAt: Date.now() },
      llmRun: {
        id: `run-${id}`,
        widgetId: 'explain',
        provider: 'test',
        model: 'test-model',
        promptVersion: '1',
        promptRaw: 'test',
        contextJson: '{}',
        responseRaw: answer,
        status: 'completed',
        createdAt: Date.now(),
      },
    },
  };
}
async function openHistory(page: Page) {
  await page.getByRole('button', { name: 'Reading', exact: true }).click();
  await page.getByRole('button', { name: 'Reading history', exact: true }).click();
}
async function selectConcept(page: Page) {
  await expect(page.locator('saul-root')).toBeAttached();
  // Real mouse selection through the injected content script and shadow UI.
  await page.locator('#concept').click({ clickCount: 3 });
  await page.getByRole('button', { name: 'Explain', exact: true }).click();
  await expect(page.getByText(answer, { exact: true })).toBeVisible();
}

test('reading flow, search/export, offscreen recovery, browser restart and deletion', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { origin } = fixtureServer;
  let browser = await sandbox.launch();
  let { popup, worker } = browser;
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await popup.getByPlaceholder('https://api.openai.com/v1').fill(`${origin}/v1`);
  await popup.getByRole('button', { name: 'Save Settings' }).click();
  await expect(popup.getByRole('button', { name: 'Saved!' })).toBeVisible();
  const article = await browser.context.newPage();
  await article.goto(`${origin}/article`);
  await selectConcept(article);
  await expect.poll(async () => (await history(popup)).history?.length).toBe(1);
  await article.getByTitle('Regenerate', { exact: true }).click();
  await expect(article.getByTitle('Regenerate', { exact: true })).toBeVisible();
  await expect(article.getByText('Failed to explain', { exact: true })).toHaveCount(0);
  expect((await history(popup)).history).toHaveLength(1);
  await article.screenshot({ path: info.outputPath('explanation.png') });
  await openHistory(popup);
  await expect(popup.getByText('"Gradient descent"', { exact: true })).toBeVisible();
  const search = popup.getByPlaceholder('Search reading history');
  await search.fill('Grad');
  await expect(popup.getByText('"Gradient descent"', { exact: true })).toBeVisible();
  await search.fill('unmatchedword');
  await expect(popup.getByText('No matching highlights.')).toBeVisible();
  await search.fill('');
  await popup.getByText('"Gradient descent"', { exact: true }).click();
  await expect(popup.getByText(answer, { exact: true })).toBeVisible();
  const download = popup.waitForEvent('download');
  await popup.getByRole('button', { name: 'Export to Markdown' }).click();
  const file = await (await download).path();
  expect(await readFile(file!, 'utf8')).toContain(answer);
  await popup.screenshot({ path: info.outputPath('history.png') });

  await worker.evaluate(() => chrome.offscreen.closeDocument());
  expect((await history(popup)).history).toHaveLength(1);
  browser = await sandbox.launch();
  popup = browser.popup;
  await openHistory(popup);
  await expect(popup.getByText('"Gradient descent"', { exact: true })).toBeVisible();
  await popup.getByTitle('Delete', { exact: true }).click();
  await expect(popup.getByText('No highlights recorded yet.')).toBeVisible();
  expect((await db(popup, record(origin, 'clear-me'))).success).toBe(true);
  await popup.reload();
  await openHistory(popup);
  popup.once('dialog', (dialog) => dialog.accept());
  await popup.getByRole('button', { name: 'Clear All', exact: true }).click();
  await expect(popup.getByText('No highlights recorded yet.')).toBeVisible();
  browser = await sandbox.launch();
  expect((await history(browser.popup)).history).toEqual([]);
});

test('concurrent cold-start requests persist and failed writes remain atomic', async ({
  sandbox,
  fixtureServer,
}) => {
  const { origin } = fixtureServer;
  const browser = await sandbox.launch();
  await browser.worker.evaluate(async () => {
    if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
  });
  const responses = await Promise.all(
    Array.from({ length: 8 }, (_, i) => db(browser.popup, record(origin, `parallel-${i}`))),
  );
  expect(responses).toEqual(Array.from({ length: 8 }, () => ({ success: true })));
  expect((await history(browser.popup)).history).toHaveLength(8);
  const invalid = record(origin, 'rolled-back');
  invalid.payload.llmRun.id = 'run-parallel-0';
  expect((await db(browser.popup, invalid)).success).toBe(false);
  expect((await history(browser.popup)).history).toHaveLength(8);
  await browser.worker.evaluate(() => chrome.offscreen.closeDocument());
  expect((await history(browser.popup)).history).toHaveLength(8);
  const tagged = record(origin, 'tagged');
  tagged.payload.llmRun.responseRaw = 'A <term note="Steepest increase">gradient</term> changes.';
  expect((await db(browser.popup, tagged)).success).toBe(true);
  await openHistory(browser.popup);
  await browser.popup.getByText('"Gradient tagged"', { exact: true }).click();
  await expect(browser.popup.getByText('A gradient changes.', { exact: true })).toBeVisible();
  await expect(
    browser.popup.getByText(tagged.payload.llmRun.responseRaw, { exact: true }),
  ).toHaveCount(0);
});
