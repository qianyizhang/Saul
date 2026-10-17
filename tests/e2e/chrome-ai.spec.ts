import { CHROME_AI_ENABLED } from '../../src/models/chrome-ai';
import { test, expect } from './fixtures.ts';
import { explainSelection, getHistory, getFirstHistory } from './driver.ts';

test('on-device provider respects the temporary availability switch', async ({ sandbox }, info) => {
  const { popup } = await sandbox.launch();
  if (!CHROME_AI_ENABLED) {
    await popup.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(popup.locator('option[value="chrome-ai"]')).toHaveJSProperty('disabled', true);
    await expect(
      popup.getByRole('button', { name: 'Prepare on-device model', exact: true }),
    ).toHaveCount(0);
    return;
  }
  const diagnostics = await popup.evaluate(async () => {
    const lm = (globalThis as unknown as { LanguageModel?: { availability(): Promise<string> } })
      .LanguageModel;
    let availability = 'unsupported',
      error: string | undefined;
    try {
      if (lm) availability = await lm.availability();
    } catch (e) {
      error = String(e);
      availability = 'check failed';
    }
    return { userAgent: navigator.userAgent, apiExposed: !!lm, availability, error };
  });
  await info.attach('on-device-diagnostics', {
    body: JSON.stringify(diagnostics, null, 2),
    contentType: 'application/json',
  });
  console.log('On-device browser probe:', JSON.stringify(diagnostics));
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await popup.getByLabel('Provider', { exact: true }).selectOption('chrome-ai');
  await expect(
    popup.getByText(`Availability: ${diagnostics.availability}.`, { exact: true }),
  ).toBeVisible();
  if (['unavailable', 'unsupported'].includes(diagnostics.availability)) {
    await expect(
      popup.getByRole('button', { name: 'Prepare on-device model', exact: true }),
    ).toBeDisabled();
    await expect(
      popup.getByRole('button', { name: 'Test generation', exact: true }),
    ).toBeDisabled();
    await expect(popup.getByText('On-device model is ready.', { exact: true })).toHaveCount(0);
  }
  await popup.screenshot({ path: info.outputPath('chrome-ai-availability.png'), fullPage: true });
});

test.describe('on-device provider with a deterministic model fixture', () => {
  test.skip(
    !CHROME_AI_ENABLED,
    'On-device provider temporarily disabled; retain coverage for re-enabling.',
  );
  test.use({ chromeAiFixtures: true });
  test('prepares with activation, tests real generation code, and saves a reading through the offscreen runner', async ({
    sandbox,
    fixtureServer,
  }) => {
    const { popup, context } = await sandbox.launch();
    const remoteRequests = fixtureServer.requests.length;
    await popup.getByRole('button', { name: 'Settings', exact: true }).click();
    await popup.getByLabel('Provider', { exact: true }).selectOption('chrome-ai');
    await expect(popup.getByText('Availability: downloadable.', { exact: true })).toBeVisible();
    await expect(
      popup.getByRole('button', { name: 'Test generation', exact: true }),
    ).toBeDisabled();
    await popup.getByRole('button', { name: 'Prepare on-device model', exact: true }).click();
    await expect(popup.getByText('On-device model is ready.', { exact: true })).toBeVisible();
    await expect(popup.getByText('Availability: available.', { exact: true })).toBeVisible();
    await popup.getByRole('button', { name: 'Test generation', exact: true }).click();
    await expect(
      popup.getByText('Generation succeeded: A local explanation.', { exact: true }),
    ).toBeVisible();
    const calls = await popup.evaluate(
      () =>
        (
          globalThis as unknown as {
            chromeAiFixture: {
              calls: { activated: boolean; systemPrompt: string }[];
              destroyed: number;
            };
          }
        ).chromeAiFixture,
    );
    expect(calls.calls[0]?.activated).toBe(true);
    expect(calls.calls[1]?.systemPrompt).toBe('Reply briefly.');
    expect(calls.destroyed).toBe(2);
    await popup.getByRole('button', { name: 'Save Settings', exact: true }).click();
    await expect(popup.getByRole('button', { name: 'Saved!', exact: true })).toBeVisible();
    const page = await context.newPage();
    await page.goto(fixtureServer.origin + '/article');
    await explainSelection(page);
    await expect.poll(async () => (await getHistory(popup))[0]?.latest.status).toBe('completed');
    const row = await getFirstHistory(popup);
    expect(row.latest.provider).toBe('chrome-ai');
    expect(row.latest.responseRaw).toBe('A local explanation.');
    expect(fixtureServer.requests).toHaveLength(remoteRequests);
  });
  test('reports availability errors and refuses false preparation success', async ({ sandbox }) => {
    const { popup } = await sandbox.launch();
    await popup.getByRole('button', { name: 'Settings', exact: true }).click();
    await popup.getByLabel('Provider', { exact: true }).selectOption('chrome-ai');
    await expect(popup.getByText('Availability: downloadable.', { exact: true })).toBeVisible();
    await popup.evaluate(() => {
      (
        globalThis as unknown as { chromeAiFixture: { readyAfterCreate: boolean } }
      ).chromeAiFixture.readyAfterCreate = false;
    });
    await popup.getByRole('button', { name: 'Prepare on-device model', exact: true }).click();
    await expect(popup.getByRole('alert')).toContainText('not ready');
    await expect(popup.getByText('On-device model is ready.', { exact: true })).toHaveCount(0);
    await popup.evaluate(() => {
      (
        globalThis as unknown as { chromeAiFixture: { availabilityError: string } }
      ).chromeAiFixture.availabilityError = 'Eligibility check failed';
    });
    await popup.getByRole('button', { name: 'Check availability', exact: true }).click();
    await expect(popup.getByText('Availability: check failed.', { exact: true })).toBeVisible();
    await expect(popup.getByRole('alert')).toContainText('Eligibility check failed');
    await popup.evaluate(() => {
      const fixture = (
        globalThis as unknown as {
          chromeAiFixture: {
            availabilityError: string;
            availability: string;
            generationError: boolean;
          };
        }
      ).chromeAiFixture;
      fixture.availabilityError = '';
      fixture.availability = 'available';
      fixture.generationError = true;
    });
    await popup.getByRole('button', { name: 'Check availability', exact: true }).click();
    await popup.getByRole('button', { name: 'Test generation', exact: true }).click();
    await expect(popup.getByRole('alert')).toContainText('Local inference failed');
    await expect(popup.getByText(/Generation succeeded:/)).toHaveCount(0);
  });
});

test('saved on-device selection shows a recovery choice without silently switching providers', async ({
  sandbox,
}) => {
  const { popup } = await sandbox.launch();
  await popup.evaluate(async () => {
    await chrome.storage.local.set({ saul_user_settings: { activeProvider: 'chrome-ai' } });
  });
  await popup.reload();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(popup.getByLabel('Provider', { exact: true })).toHaveValue('chrome-ai');
  await expect(
    popup.getByText('Chrome on-device AI is temporarily disabled.', { exact: false }),
  ).toBeVisible();
  await expect(
    popup.getByRole('button', { name: 'Prepare on-device model', exact: true }),
  ).toHaveCount(0);
  await popup.getByRole('button', { name: 'Save Settings', exact: true }).click();
  await expect(popup.getByRole('alert')).toContainText('temporarily disabled');
  await popup.getByLabel('Provider', { exact: true }).selectOption('chatgpt-plan');
  await expect(
    popup.getByRole('button', { name: 'Continue with ChatGPT', exact: true }),
  ).toBeVisible();
});
