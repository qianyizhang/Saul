import { settingsSection } from './driver.ts';
import { test, expect } from './fixtures.ts';

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
  await expect(popup.getByRole('alert')).toContainText('has been retired');
  await settingsSection(popup, 'Presets');
  await popup.getByLabel('Connection', { exact: true }).selectOption('gpt-plan');
  await settingsSection(popup, 'Connections');
  await expect(
    popup.getByRole('button', { name: 'Continue with ChatGPT', exact: true }),
  ).toBeVisible();
});
