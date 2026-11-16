import { settingsSection } from './driver.ts';
import { test, expect } from './fixtures.ts';
import type { UserSettings } from '../../src/types';

test('saved on-device selection shows a recovery choice without silently switching connections', async ({
  sandbox,
}) => {
  const { popup } = await sandbox.launch();
  await popup.evaluate(async () => {
    await chrome.storage.local.set({ saul_user_settings: { activeProvider: 'chrome-ai' } });
  });
  await popup.reload();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(popup, 'Presets');
  await expect(popup.getByLabel('Connection', { exact: true })).toHaveValue('chrome-ai');
  await expect(
    popup.getByText('Chrome on-device AI has been retired.', { exact: false }),
  ).toBeVisible();
  await expect(
    popup.getByRole('button', { name: 'Prepare on-device model', exact: true }),
  ).toHaveCount(0);
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(popup.getByText('Saved', { exact: true })).toBeVisible();
  await expect(popup.getByLabel('Connection', { exact: true })).toHaveValue('chrome-ai');
  await settingsSection(popup, 'Presets');
  await popup.getByLabel('Connection', { exact: true }).selectOption('openai-compatible');
  await popup.getByLabel('Model name', { exact: true }).fill('fixture-model');
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(popup.getByText('Saved', { exact: true })).toBeVisible();
  const saved = await popup.evaluate(
    async () =>
      (await chrome.storage.local.get('saul_user_settings')).saul_user_settings as UserSettings,
  );
  expect(saved.activeProvider).toBe('chrome-ai');
  expect(saved.configuration?.presets[0]).toMatchObject({
    provider: 'openai-compatible',
    model: 'fixture-model',
  });
  await popup.reload();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(popup, 'Presets');
  await expect(popup.getByLabel('Connection', { exact: true })).toHaveValue('openai-compatible');
  await expect(popup.getByLabel('Model name', { exact: true })).toHaveValue('fixture-model');
});
