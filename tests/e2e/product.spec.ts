import { test, expect } from './fixtures.ts';
import { configureFixtureProvider, createFixtureServer, seedHistory } from './support.ts';
import { getFirstHistory, sendDb, sendWorkspace as tabs } from './driver.ts';
test('library bookmarks, explanation search, punctuation and pagination survive restart', async ({
  sandbox,
  fixtureServer,
}) => {
  const browser = await sandbox.launch();
  let { popup } = browser;
  await seedHistory(browser, fixtureServer.origin, 35);
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
  await popup.getByRole('button', { name: 'gradient', exact: true }).click();
  await popup.getByRole('heading', { name: 'Reading history', exact: true }).hover();
  await expect(popup.getByRole('tooltip')).toBeVisible();
  await expect(popup.getByRole('tooltip')).toContainText('Steepest increase');
  ({ popup } = await sandbox.launch());
  await popup.getByRole('button', { name: 'Reading history', exact: true }).click();
  await popup.getByRole('button', { name: 'Bookmarks', exact: true }).click();
  await expect(popup.locator('.history-title')).toHaveText([title!]);
});

test('export includes more than 1000 records and readable concept notes', async ({
  sandbox,
  fixtureServer,
}) => {
  const browser = await sandbox.launch();
  const { popup } = browser;
  await seedHistory(browser, fixtureServer.origin, 1005, {
    prefix: 'export',
    response: 'A <term note="Direction of change">gradient</term>.',
  });
  const exported = await sendDb(popup, { type: 'DB_EXPORT_MARKDOWN', payload: undefined });
  expect(exported).toContain('Total Selections: 1005');
  expect(exported).toContain('Selection export-0');
  expect(exported).toContain('Selection export-1004');
  expect(exported).toContain('**gradient:** Direction of change');
  expect(exported).not.toContain('<term');
});

test('provider profiles preserve their own credentials and clear keys across origins', async ({
  sandbox,
  fixtureServer,
}) => {
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
});

test('missing and stale profile selections recover the current config and remain editable', async ({
  sandbox,
  fixtureServer,
}) => {
  const { popup } = await sandbox.launch();
  for (const [storedActiveProfileId, recoveredId, model] of [
    [undefined, 'recovered-current', 'recovered-missing'],
    ['retired-profile', 'retired-profile', 'recovered-stale'],
  ] as const) {
    await popup.evaluate(
      async ({ origin, storedActiveProfileId }) => {
        await chrome.storage.local.set({
          saul_user_settings: {
            activeProvider: 'openai-compatible',
            openaiCompatible: {
              baseUrl: origin + '/v1',
              apiKey: 'current-key',
              model: 'current-model',
              temperature: 0.3,
            },
            profiles: [
              {
                id: 'legacy',
                name: 'Legacy',
                config: {
                  baseUrl: origin + '/v1',
                  apiKey: 'legacy-key',
                  model: 'legacy-model',
                  temperature: 0.3,
                },
              },
            ],
            ...(storedActiveProfileId === undefined
              ? {}
              : { activeProfileId: storedActiveProfileId }),
          },
        });
      },
      { origin: fixtureServer.origin, storedActiveProfileId },
    );
    if (popup.url().includes('#settings')) await popup.reload();
    else await popup.getByRole('button', { name: 'Settings', exact: true }).click();

    await expect(popup.getByLabel('Saved profile', { exact: true })).toHaveValue(recoveredId);
    await expect(popup.getByLabel('Model name', { exact: true })).toHaveValue('current-model');
    await popup.getByLabel('Model name', { exact: true }).fill(model);
    await popup.getByRole('button', { name: 'Save Settings', exact: true }).click();
    await expect(popup.getByRole('button', { name: 'Saved!', exact: true })).toBeVisible();
    const saved = await popup.evaluate(async () => {
      const { saul_user_settings: settings } = await chrome.storage.local.get('saul_user_settings');
      return settings as {
        activeProfileId: string;
        profiles: { id: string; config: { model: string } }[];
      };
    });
    expect(saved.activeProfileId).toBe(recoveredId);
    expect(saved.profiles.find((profile) => profile.id === recoveredId)?.config.model).toBe(model);
    expect(saved.profiles.find((profile) => profile.id === 'legacy')?.config.model).toBe(
      'legacy-model',
    );
  }
});

test('tab previews do not mutate, sorting can undo, and stale previews are rejected', async ({
  sandbox,
  fixtureServer,
}) => {
  const { popup, context } = await sandbox.launch();
  for (const title of ['Zulu', 'Alpha']) {
    const page = await context.newPage();
    await page.goto(fixtureServer.origin + '/article');
    await page.evaluate((title) => (document.title = title), title);
  }
  await popup.getByRole('button', { name: 'Tabs', exact: true }).click();
  await expect(popup.getByText('Zulu', { exact: true })).toBeVisible();
  const before = (await tabs(popup, { action: 'list' })).snapshot;
  await popup.getByLabel('Sort by', { exact: true }).selectOption('title');
  await popup.getByRole('button', { name: 'Preview sort', exact: true }).click();
  await expect(popup.getByRole('region', { name: 'Tab change preview' })).toBeVisible();
  expect((await tabs(popup, { action: 'list' })).snapshot.tabs.map((tab) => tab.id)).toEqual(
    before.tabs.map((tab) => tab.id),
  );
  await popup.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(popup.getByText('Changes applied.', { exact: true })).toBeVisible();
  await popup.getByRole('button', { name: 'Undo last sort', exact: true }).click();
  await expect(popup.getByText('Previous tab order restored.')).toBeVisible();
  expect((await tabs(popup, { action: 'list' })).snapshot.tabs.map((tab) => tab.id)).toEqual(
    before.tabs.map((tab) => tab.id),
  );
  await popup.getByRole('button', { name: 'Preview sort', exact: true }).click();
  await expect(popup.getByRole('button', { name: 'Apply changes', exact: true })).toBeVisible();
  await context.newPage();
  await popup.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(popup.getByRole('alert')).toContainText('Tabs changed since this preview');
  await popup.getByRole('button', { name: 'Refresh tabs', exact: true }).click();
  await popup.getByRole('button', { name: 'Preview sort', exact: true }).click();
  await popup.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(popup.getByRole('button', { name: 'Undo last sort', exact: true })).toBeEnabled();
  await context.newPage();
  await popup.getByRole('button', { name: 'Refresh tabs', exact: true }).click();
  await expect(popup.getByRole('button', { name: 'Undo last sort', exact: true })).toBeDisabled();
  await popup.getByRole('checkbox', { name: 'Select Zulu', exact: true }).check();
  await popup.getByRole('checkbox', { name: 'Select Alpha', exact: true }).check();
  await popup.getByRole('button', { name: 'Preview group', exact: true }).click();
  await popup.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(popup.getByText('Changes applied.', { exact: true })).toBeVisible();
  const grouped = (await tabs(popup, { action: 'list' })).snapshot;
  expect(grouped.groups).toEqual(
    expect.arrayContaining([expect.objectContaining({ title: 'Research' })]),
  );
});

test('empty model output stays a failed attempt without a completed answer', async ({
  sandbox,
}) => {
  const server = await createFixtureServer('');
  try {
    const { popup, context } = await sandbox.launch();
    await configureFixtureProvider(popup, server.origin);
    const article = await context.newPage();
    await article.goto(server.origin + '/article');
    await expect(article.locator('saul-root')).toBeAttached();
    await article.locator('#concept').click({ clickCount: 3 });
    await article.getByRole('button', { name: 'Explain', exact: true }).click();
    await article.getByRole('button', { name: 'View', exact: true }).click();
    await expect(article.getByRole('alert')).toContainText('The model returned no explanation');
    await expect(article.getByText('Ready · saved on this device', { exact: false })).toHaveCount(
      0,
    );
    expect((await getFirstHistory(popup)).latest.status).toBe('failed');
  } finally {
    await server.close();
  }
});

test('unreadable settings show an error instead of an editable default profile', async ({
  sandbox,
}) => {
  const { popup } = await sandbox.launch();
  await popup.evaluate(() => {
    chrome.storage.local.get = async () => {
      throw new Error('Storage unavailable');
    };
  });
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(popup.getByRole('alert')).toContainText('Could not read saved settings');
  await expect(popup.getByRole('button', { name: 'Save Settings', exact: true })).toHaveCount(0);
  await expect(popup.getByRole('button', { name: 'Back up and reset settings' })).toHaveCount(0);
});

test('malformed settings expose their field error and require explicit backup before reset', async ({
  sandbox,
}) => {
  const { popup } = await sandbox.launch();
  const invalid = { openaiCompatible: { temperature: 'warm' } };
  await popup.evaluate(
    async (settings) => chrome.storage.local.set({ saul_user_settings: settings }),
    invalid,
  );
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(popup.getByRole('alert')).toContainText(
    'Saved provider temperature must be a finite number',
  );
  await popup.getByRole('button', { name: 'Back up and reset settings', exact: true }).click();
  await expect(popup.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(
    popup.getByText(
      'Defaults restored. The previous saved settings remain in a local recovery backup.',
      { exact: true },
    ),
  ).toBeVisible();
  const stored = await popup.evaluate(async () =>
    chrome.storage.local.get(['saul_user_settings', 'saul_user_settings_recovery_backup']),
  );
  expect(stored.saul_user_settings).toMatchObject({
    activeProvider: 'openai-compatible',
    openaiCompatible: { model: 'gpt-4o-mini' },
  });
  expect(stored.saul_user_settings_recovery_backup).toEqual(invalid);
});

test('keyboard explanation can pin, follow up, and bookmark', async ({
  sandbox,
  fixtureServer,
}) => {
  const { popup, context } = await sandbox.launch();
  await configureFixtureProvider(popup, fixtureServer.origin);
  const article = await context.newPage();
  await article.goto(fixtureServer.origin + '/article');
  await expect(article.locator('saul-root')).toBeAttached();
  await article.locator('#concept').click({ clickCount: 3 });
  await article.keyboard.press('Alt+Shift+E');
  await article.getByRole('button', { name: 'View', exact: true }).click();
  await expect(article.getByText('Ready · saved on this device', { exact: false })).toBeVisible();
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
  await expect(article.getByText('Ready · saved on this device', { exact: false })).toBeVisible();
  await article.getByRole('button', { name: 'Bookmark', exact: true }).click();
  await expect(article.getByRole('button', { name: 'Remove bookmark', exact: true })).toBeVisible();
  expect((await getFirstHistory(popup)).bookmarked).toBe(true);
});

test('stopping a slow explanation retains partial text without saving a completed run', async ({
  sandbox,
}) => {
  const server = await createFixtureServer(
    'A gradient describes how a function changes over time.',
    { gated: true },
  );
  try {
    const { popup, context } = await sandbox.launch();
    await configureFixtureProvider(popup, server.origin);
    const article = await context.newPage();
    await article.goto(server.origin + '/article');
    await expect(article.locator('saul-root')).toBeAttached();
    await article.locator('#concept').click({ clickCount: 3 });
    await article.getByRole('button', { name: 'Explain', exact: true }).click();
    await article.getByRole('button', { name: 'View', exact: true }).click();
    await expect(article.getByText('A gradient describes how a', { exact: false })).toBeVisible();
    await article.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(article.getByText('Incomplete · stopped')).toBeVisible();
    expect((await getFirstHistory(popup)).latest.status).toBe('cancelled');
    server.setGated(false);
    server.releaseAll();
    await article.getByRole('button', { name: 'Retry explanation', exact: true }).click();
    await expect(article.getByText('Ready · saved on this device', { exact: false })).toBeVisible();
    expect(await sendDb(popup, { type: 'DB_GET_HISTORY', payload: {} })).toHaveLength(1);
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

test('save locks the draft; provider tests lock only provider settings and remain cancellable', async ({
  sandbox,
}) => {
  const server = await createFixtureServer('Test response.', { gated: true });
  try {
    const { popup } = await sandbox.launch();
    await configureFixtureProvider(popup, server.origin);
    await popup.getByRole('button', { name: 'Settings', exact: true }).click();
    await popup.getByRole('button', { name: 'Test generation', exact: true }).click();
    await expect(popup.getByLabel('Profile name', { exact: true })).toBeDisabled();
    await expect(popup.getByLabel('Response language', { exact: true })).toBeEnabled();
    await popup.getByLabel('Response language', { exact: true }).selectOption('English');
    await popup.getByRole('button', { name: 'Stop test', exact: true }).click();
    await expect(popup.getByLabel('Profile name', { exact: true })).toBeEnabled();
    // Hold the actual storage write so the save boundary can be observed reliably.
    await popup.evaluate(() => {
      const original = chrome.storage.local.set.bind(chrome.storage.local) as (
        items: object,
      ) => Promise<void>;
      const state = globalThis as typeof globalThis & { finishSettingsSave?: () => void };
      chrome.storage.local.set = (async (items: object) => {
        await new Promise<void>((resolve) => {
          state.finishSettingsSave = resolve;
        });
        return original(items);
      }) as typeof chrome.storage.local.set;
    });
    await popup.getByRole('button', { name: 'Save Settings', exact: true }).click();
    await expect(popup.getByLabel('Profile name', { exact: true })).toBeDisabled();
    await expect(popup.getByLabel('Response language', { exact: true })).toBeDisabled();
    await popup.evaluate(() =>
      (
        globalThis as typeof globalThis & { finishSettingsSave?: () => void }
      ).finishSettingsSave?.(),
    );
    await expect(popup.getByRole('button', { name: 'Saved!', exact: true })).toBeVisible();
    await expect(popup.getByLabel('Response language', { exact: true })).toBeEnabled();
  } finally {
    await server.close();
  }
});
