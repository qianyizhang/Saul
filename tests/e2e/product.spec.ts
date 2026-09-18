import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.ts';
import { createFixtureServer } from './support.ts';

const db = (page: Page, message: object): Promise<any> =>
  page.evaluate(
    (message) => chrome.runtime.sendMessage({ target: 'saul-background', message }),
    message,
  );
const tabs = (page: Page, request: object): Promise<any> =>
  page.evaluate(
    (request) => chrome.runtime.sendMessage({ type: 'WORKSPACE_TABS', ...request }),
    request,
  );
function record(id: string, origin: string) {
  return {
    type: 'DB_SAVE_RECORD',
    payload: {
      page: { url: origin + '/article', title: 'Calculus notes' },
      selection: { id, text: `Selection ${id}`, createdAt: Date.now() },
      llmRun: {
        id: `run-${id}`,
        widgetId: 'explain',
        provider: 'test',
        model: 'test-model',
        promptVersion: '1',
        promptRaw: 'test',
        contextJson: '{}',
        responseRaw: 'A <term note="Steepest increase">gradient</term> explains velocity.',
        status: 'completed',
        createdAt: Date.now(),
      },
    },
  };
}

test('library bookmarks, explanation search, punctuation and pagination survive restart', async ({
  sandbox,
  fixtureServer,
}, info) => {
  let { popup } = await sandbox.launch();
  for (let i = 0; i < 35; i++)
    expect((await db(popup, record(`item-${i}`, fixtureServer.origin))).success).toBe(true);
  await popup.goto(popup.url().replace('popup.html', 'library.html') + '#history');
  await expect(popup.locator('.history-entry')).toHaveCount(30);
  await popup.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(popup.locator('.history-entry')).toHaveCount(5);
  const first = popup.locator('.history-entry').first();
  const title = await first.locator('.history-title').textContent();
  await first.getByRole('button', { name: 'Bookmark', exact: true }).click();
  await popup.getByRole('button', { name: 'Bookmarks', exact: true }).click();
  await expect(popup.locator('.history-entry')).toHaveCount(1);
  await popup.getByPlaceholder('Search reading history').fill('velocity');
  await expect(popup.locator('.history-entry')).toHaveCount(1);
  await popup.getByPlaceholder('Search reading history').fill('"(NOT):*');
  await expect(popup.getByText('No matching highlights.')).toBeVisible();
  await expect(popup.getByRole('alert')).toHaveCount(0);
  await popup.getByPlaceholder('Search reading history').fill('');
  await popup.locator('.history-title').click();
  await expect(popup.getByRole('button', { name: 'gradient', exact: true })).toBeVisible();
  await popup.getByRole('button', { name: 'gradient', exact: true }).focus();
  await expect(popup.getByRole('tooltip')).toContainText('Steepest increase');
  await popup.screenshot({ path: info.outputPath('library.png') });
  ({ popup } = await sandbox.launch());
  await popup.getByRole('button', { name: 'Reading history', exact: true }).click();
  await popup.getByRole('button', { name: 'Bookmarks', exact: true }).click();
  await expect(popup.locator('.history-title')).toHaveText([title!]);
});

test('export includes more than 1000 records and readable concept notes', async ({
  sandbox,
  fixtureServer,
}) => {
  const { popup } = await sandbox.launch();
  const results = await popup.evaluate(
    async ({ origin, count }) => {
      const replies = [];
      for (let i = 0; i < count; i++)
        replies.push(
          await chrome.runtime.sendMessage({
            target: 'saul-background',
            message: {
              type: 'DB_SAVE_RECORD',
              payload: {
                page: { url: origin, title: 'Export fixture' },
                selection: { id: `export-${i}`, text: `Item ${i}`, createdAt: i + 1 },
                llmRun: {
                  id: `run-${i}`,
                  widgetId: 'explain',
                  provider: 'test',
                  model: 'test',
                  promptVersion: '1',
                  promptRaw: 'test',
                  contextJson: '{}',
                  responseRaw: 'A <term note="Direction of change">gradient</term>.',
                  status: 'completed',
                  createdAt: i + 1,
                },
              },
            },
          }),
        );
      return replies.every((r) => r.success);
    },
    { origin: fixtureServer.origin, count: 1005 },
  );
  expect(results).toBe(true);
  const exported = await db(popup, { type: 'DB_EXPORT_MARKDOWN' });
  expect(exported.markdown).toContain('Total Selections: 1005');
  expect(exported.markdown).toContain('Item 0');
  expect(exported.markdown).toContain('Item 1004');
  expect(exported.markdown).toContain('**gradient:** Direction of change');
  expect(exported.markdown).not.toContain('<term');
});

test('provider profiles preserve their own credentials and clear keys across origins', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { popup } = await sandbox.launch();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await popup.getByLabel('Profile name', { exact: true }).fill('Local test');
  await popup.getByPlaceholder('https://api.openai.com/v1').fill(fixtureServer.origin + '/v1');
  await popup.getByPlaceholder('Optional for local models').fill('fixture-key-one');
  await popup.getByRole('button', { name: 'New profile', exact: true }).click();
  await expect(popup.getByPlaceholder('Optional for local models')).toHaveValue('');
  await popup.getByLabel('Profile name', { exact: true }).fill('Second profile');
  await popup.getByPlaceholder('Optional for local models').fill('fixture-key-two');
  await popup.getByLabel('Saved profile', { exact: true }).selectOption({ label: 'Local test' });
  await expect(popup.getByPlaceholder('Optional for local models')).toHaveValue('fixture-key-one');
  await popup
    .getByLabel('Saved profile', { exact: true })
    .selectOption({ label: 'Second profile' });
  await expect(popup.getByPlaceholder('Optional for local models')).toHaveValue('fixture-key-two');
  await popup.getByRole('button', { name: 'DeepSeek', exact: true }).click();
  await expect(popup.getByPlaceholder('Optional for local models')).toHaveValue('');
  await popup.getByRole('button', { name: 'Save Settings', exact: true }).click();
  await expect(popup.getByRole('button', { name: 'Saved!', exact: true })).toBeVisible();
  await popup.reload();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await popup.getByLabel('Saved profile', { exact: true }).selectOption({ label: 'Local test' });
  await expect(popup.getByPlaceholder('Optional for local models')).toHaveValue('fixture-key-one');
  await popup.getByRole('button', { name: 'Test generation', exact: true }).click();
  await expect(popup.getByText(/Generation succeeded:/)).toBeVisible();
  await popup.screenshot({ path: info.outputPath('settings.png') });
});

test('tab previews do not mutate, sorting can undo, and stale previews are rejected', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { popup, context } = await sandbox.launch();
  for (const title of ['Zulu', 'Alpha']) {
    const page = await context.newPage();
    await page.goto(fixtureServer.origin + '/article');
    await page.evaluate((title) => (document.title = title), title);
  }
  await popup.getByRole('button', { name: 'Tabs', exact: true }).click();
  await expect(popup.getByText('Zulu', { exact: true })).toBeVisible();
  const before = (await tabs(popup, { action: 'list' })).result.snapshot;
  await popup.getByLabel('Sort by', { exact: true }).selectOption('title');
  await popup.getByRole('button', { name: 'Preview sort', exact: true }).click();
  await expect(popup.getByRole('region', { name: 'Tab change preview' })).toBeVisible();
  expect(
    (await tabs(popup, { action: 'list' })).result.snapshot.tabs.map((t: any) => t.id),
  ).toEqual(before.tabs.map((t: any) => t.id));
  await popup.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(popup.getByText('Changes applied.', { exact: true })).toBeVisible();
  await popup.getByRole('button', { name: 'Undo last sort', exact: true }).click();
  await expect(popup.getByText('Previous tab order restored.')).toBeVisible();
  expect(
    (await tabs(popup, { action: 'list' })).result.snapshot.tabs.map((t: any) => t.id),
  ).toEqual(before.tabs.map((t: any) => t.id));
  await popup.getByRole('button', { name: 'Preview sort', exact: true }).click();
  await expect(popup.getByRole('button', { name: 'Apply changes', exact: true })).toBeVisible();
  await context.newPage();
  await popup.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(popup.getByRole('alert')).toContainText('Tabs changed since this preview');
  await popup.getByRole('button', { name: 'Refresh tabs', exact: true }).click();
  await popup.getByRole('checkbox', { name: 'Select Zulu', exact: true }).check();
  await popup.getByRole('checkbox', { name: 'Select Alpha', exact: true }).check();
  await popup.getByRole('button', { name: 'Preview group', exact: true }).click();
  await popup.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(popup.getByText('Changes applied.', { exact: true })).toBeVisible();
  const grouped = (await tabs(popup, { action: 'list' })).result.snapshot;
  expect(grouped.groups).toEqual(
    expect.arrayContaining([expect.objectContaining({ title: 'Research' })]),
  );
  await popup.screenshot({ path: info.outputPath('tabs.png') });
});

test('keyboard explanation can pin, follow up, and bookmark', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { popup, context } = await sandbox.launch();
  await popup.evaluate(async (origin) => {
    await chrome.storage.local.set({
      saul_user_settings: {
        activeProvider: 'openai-compatible',
        openaiCompatible: { baseUrl: origin + '/v1', apiKey: '', model: 'test-model' },
      },
    });
  }, fixtureServer.origin);
  const article = await context.newPage();
  await article.goto(fixtureServer.origin + '/article');
  await expect(article.locator('saul-root')).toBeAttached();
  await article.locator('#concept').click({ clickCount: 3 });
  await article.keyboard.press('Alt+Shift+E');
  await expect(article.getByText('Saved to history', { exact: false })).toBeVisible();
  await article.getByRole('button', { name: 'Pin explanation', exact: true }).click();
  await article.locator('h1').click();
  await expect(article.getByRole('region', { name: 'Saul explanation' })).toBeVisible();
  await article.evaluate(() => {
    document.body.style.minHeight = '2500px';
  });
  await article.mouse.wheel(0, 600);
  await expect
    .poll(async () => {
      const box = await article.getByRole('region', { name: 'Saul explanation' }).boundingBox();
      return Boolean(box && box.y >= 0 && box.y + box.height <= 800);
    })
    .toBe(true);
  await article.getByRole('button', { name: 'Simpler', exact: true }).click();
  await expect(article.getByText('Saved to history', { exact: false })).toBeVisible();
  await article.getByRole('button', { name: 'Bookmark', exact: true }).click();
  await expect(article.getByRole('button', { name: 'Remove bookmark', exact: true })).toBeVisible();
  const history = await db(popup, { type: 'DB_GET_HISTORY', payload: {} });
  expect(history.history).toHaveLength(1);
  expect(history.history[0].bookmarked).toBe(true);
  await article.screenshot({ path: info.outputPath('reading-card.png') });
});

test('stopping a slow explanation retains partial text without saving a completed run', async ({
  sandbox,
}) => {
  const server = await createFixtureServer(
    'A gradient describes how a function changes over time.',
    { chunkDelayMs: 3000 },
  );
  try {
    const { popup, context } = await sandbox.launch();
    await popup.evaluate(async (origin) => {
      await chrome.storage.local.set({
        saul_user_settings: {
          activeProvider: 'openai-compatible',
          openaiCompatible: { baseUrl: origin + '/v1', apiKey: '', model: 'test-model' },
        },
      });
    }, server.origin);
    const article = await context.newPage();
    await article.goto(server.origin + '/article');
    await expect(article.locator('saul-root')).toBeAttached();
    await article.locator('#concept').click({ clickCount: 3 });
    await article.getByRole('button', { name: 'Explain', exact: true }).click();
    await expect(article.getByText('A gradient describes how a', { exact: false })).toBeVisible();
    await article.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(article.getByText('Stopped · partial explanation not saved')).toBeVisible();
    expect((await db(popup, { type: 'DB_GET_HISTORY', payload: {} })).history).toHaveLength(0);
    await article.getByRole('button', { name: 'Regenerate', exact: true }).click();
    await expect(article.getByText('Saved to history', { exact: false })).toBeVisible();
    expect((await db(popup, { type: 'DB_GET_HISTORY', payload: {} })).history).toHaveLength(1);
  } finally {
    await server.close();
  }
});

test('workspace navigation protects drafts and on-device preparation can be stopped', async ({
  sandbox,
}) => {
  const { popup } = await sandbox.launch();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(popup.getByRole('link', { name: 'Open full workspace' })).toHaveAttribute(
    'href',
    /library\.html#settings$/,
  );
  await popup.getByLabel('Model name', { exact: true }).fill('unsaved-model');
  popup.once('dialog', (dialog) => dialog.dismiss());
  await popup.evaluate(() => {
    location.hash = 'tabs';
  });
  await expect(popup).toHaveURL(/#settings$/);
  await expect(popup.getByLabel('Model name', { exact: true })).toHaveValue('unsaved-model');
  popup.once('dialog', (dialog) => dialog.accept());
  await popup.evaluate(() => {
    location.hash = 'tabs';
  });
  await expect(popup.getByRole('button', { name: 'Refresh tabs' })).toBeVisible();
  await popup.goBack();
  await expect(popup.getByLabel('Model name', { exact: true })).not.toHaveValue('unsaved-model');

  // Deterministic preparation that remains pending until cancelled; no model download.
  await popup.evaluate(() => {
    Object.defineProperty(globalThis, 'LanguageModel', {
      configurable: true,
      value: {
        availability: async () => 'downloadable',
        create: ({ signal }: { signal: AbortSignal }) =>
          new Promise((_, reject) => {
            signal.addEventListener(
              'abort',
              () => reject(new DOMException('Stopped', 'AbortError')),
              { once: true },
            );
          }),
      },
    });
  });
  await popup.getByLabel('Provider', { exact: true }).selectOption('chrome-ai');
  await popup.getByRole('button', { name: 'Prepare on-device model' }).click();
  await expect(popup.getByLabel('Provider', { exact: true })).toBeDisabled();
  await popup.getByRole('button', { name: 'Stop test' }).click();
  await expect(popup.getByRole('alert')).toContainText('Test stopped');
  await expect(popup.getByLabel('Provider', { exact: true })).toBeEnabled();
});
