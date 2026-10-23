import { test, expect } from './fixtures.ts';

test('two Settings surfaces retain a stale draft until deliberate reload', async ({
  sandbox,
}, info) => {
  const { popup, context } = await sandbox.launch();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  const other = await context.newPage();
  await other.goto(popup.url().replace('popup.html', 'library.html'));
  await expect(other.getByLabel('Model name', { exact: true })).toBeVisible();
  await popup.getByLabel('Recipe name', { exact: true }).fill('Saved in first surface');
  await other.getByLabel('Edit recipe', { exact: true }).selectOption('recipe-lookup');
  await other.getByLabel('Prompt template', { exact: true }).fill('Keep this draft: {{text}}');
  await other.getByLabel('Response language', { exact: true }).selectOption('Chinese');
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(popup.getByText('Saved', { exact: true })).toBeVisible();
  await other.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(other.getByRole('alert')).toContainText('Settings changed in another surface');
  await expect(other.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(other.getByLabel('Edit recipe', { exact: true })).toHaveValue('recipe-lookup');
  await expect(other.getByLabel('Prompt template', { exact: true })).toHaveValue(
    'Keep this draft: {{text}}',
  );
  await expect(other.getByLabel('Response language', { exact: true })).toHaveValue('Chinese');
  await expect(other.getByText('Unsaved changes', { exact: true })).toBeVisible();
  const stored = await other.evaluate(
    async () => (await chrome.storage.local.get('saul_user_settings')).saul_user_settings,
  );
  expect(stored).toHaveProperty('configuration.recipes.0.name', 'Saved in first surface');
  expect(stored).not.toHaveProperty('responseLanguage');

  for (const minimum of [true, false]) {
    await other.getByRole('checkbox', { name: 'Minimum Mode', exact: true }).setChecked(minimum);
    for (const width of [440, 1000]) {
      await other.setViewportSize({ width, height: 700 });
      for (const colorScheme of ['light', 'dark'] as const) {
        await other.emulateMedia({ colorScheme });
        await other
          .getByRole('button', { name: 'Reload saved settings', exact: true })
          .scrollIntoViewIfNeeded();
        expect(await other.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await other.screenshot({
          path: info.outputPath(
            `conflict-${minimum ? 'minimum' : 'standard'}-${width}-${colorScheme}.png`,
          ),
        });
      }
    }
  }
  other.once('dialog', (dialog) => dialog.dismiss());
  const reload = other.getByRole('button', { name: 'Reload saved settings', exact: true });
  await reload.focus();
  await other.keyboard.press('Enter');
  await expect(other.getByLabel('Prompt template', { exact: true })).toHaveValue(
    'Keep this draft: {{text}}',
  );
  other.once('dialog', (dialog) => dialog.accept());
  await other.getByRole('button', { name: 'Reload saved settings', exact: true }).click();
  await expect(other.getByLabel('Recipe name', { exact: true })).toHaveValue(
    'Saved in first surface',
  );
  await expect(other.getByRole('alert')).toHaveCount(0);
  await expect(other.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  await expect(other.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
});

test('an uncertain commit reply keeps the draft and never sends the commit again', async ({
  sandbox,
}) => {
  const { popup } = await sandbox.launch();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await popup.getByLabel('Recipe name', { exact: true }).fill('Saved but acknowledgement lost');
  await popup.evaluate(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime) as (
      message: unknown,
    ) => Promise<unknown>;
    const state = globalThis as typeof globalThis & { commitCount?: number };
    state.commitCount = 0;
    chrome.runtime.sendMessage = (async (message: {
      target?: string;
      message?: { action?: string };
    }) => {
      const reply = await original(message);
      if (message.target === 'saul-settings' && message.message?.action === 'commit') {
        state.commitCount!++;
        throw new Error('Synthetic lost response');
      }
      return reply;
    }) as typeof chrome.runtime.sendMessage;
  });
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(popup.getByRole('alert')).toContainText('save outcome is unknown');
  await expect(popup.getByLabel('Recipe name', { exact: true })).toHaveValue(
    'Saved but acknowledgement lost',
  );
  await expect(popup.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  expect(
    await popup.evaluate(
      () => (globalThis as typeof globalThis & { commitCount?: number }).commitCount,
    ),
  ).toBe(1);
  await expect(popup.getByText('Unsaved changes', { exact: true })).toBeVisible();
  popup.once('dialog', (dialog) => dialog.accept());
  await popup.getByRole('button', { name: 'Reload saved settings', exact: true }).click();
  await expect(popup.getByRole('alert')).toHaveCount(0);
  await expect(popup.getByLabel('Recipe name', { exact: true })).toHaveValue(
    'Saved but acknowledgement lost',
  );
  await expect(popup.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  expect(
    await popup.evaluate(
      () => (globalThis as typeof globalThis & { commitCount?: number }).commitCount,
    ),
  ).toBe(1);
});

test('an appearance change in another surface does not conflict with a settings draft', async ({
  sandbox,
}) => {
  const { popup, context } = await sandbox.launch();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await popup.getByLabel('Recipe name', { exact: true }).fill('Personal recipe');
  const other = await context.newPage();
  await other.goto(popup.url().replace('popup.html', 'library.html'));
  await other.getByRole('checkbox', { name: 'Minimum Mode', exact: true }).uncheck();
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(popup.getByText('Saved', { exact: true })).toBeVisible();
  await expect(popup.getByRole('alert')).toHaveCount(0);
  expect(
    (await popup.evaluate(() => chrome.storage.local.get('saul_minimum_mode'))).saul_minimum_mode,
  ).toBe(false);
});
