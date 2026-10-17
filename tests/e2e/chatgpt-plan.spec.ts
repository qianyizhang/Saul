import { test, expect } from './fixtures.ts';
import {
  explainSelection,
  getHistory,
  getFirstHistory,
  openFirstPageExplanation,
} from './driver.ts';
import type { PlanRequest, PlanEvent } from '../../native/plan-protocol.mjs';

test('ChatGPT provider settings route reading streams, preserve partial failures, and switch back', async ({
  sandbox,
  fixtureServer,
}, testInfo) => {
  const { worker, context, popup: initialPopup } = await sandbox.launch();
  let popup = initialPopup;
  const initialApiRequests = fixtureServer.requests.length;
  // Replace only the OS transport. UI, sender validation, offscreen runner and
  // durable database are production code; no native registration or real quota.
  await worker.evaluate(() => {
    const state = {
      requests: [] as PlanRequest[],
      fail: false,
      signedIn: false,
      holdLogin: true,
      finishLogin: () => {},
      holdModels: true,
      finishModels: () => {},
      reducedCapabilities: false,
      cancelled: false,
      hold: false,
      holdLogout: false,
      finishLogout: () => {},
    };
    Object.assign(globalThis, { planFixture: state });
    chrome.runtime.connectNative = (() => {
      const listeners: ((m: { id: string; event: PlanEvent }) => void)[] = [];
      return {
        onMessage: {
          addListener: (fn: (m: { id: string; event: PlanEvent }) => void) => listeners.push(fn),
        },
        onDisconnect: { addListener: () => {} },
        postMessage: (message: { id: string; request: PlanRequest; cancel?: boolean }) => {
          if (message.cancel) {
            state.cancelled = true;
            return;
          }
          state.requests.push(message.request);
          const emit = (event: PlanEvent) =>
            listeners.forEach((fn) => fn({ id: message.id, event }));
          const account = {
            id: 'oaiapp_fixture',
            label: 'Fixture account · fixture',
            signedIn: state.signedIn,
            planEnabled: state.signedIn,
          };
          queueMicrotask(() => {
            switch (message.request.action) {
              case 'accounts':
                emit({ type: 'result', accounts: [account] });
                break;
              case 'login':
                state.finishLogin = () => {
                  state.signedIn = true;
                  emit({
                    type: 'result',
                    account: { ...account, signedIn: true, planEnabled: true },
                  });
                };
                if (!state.holdLogin) state.finishLogin();
                break;
              case 'models':
                state.finishModels = () =>
                  emit({
                    type: 'result',
                    models: [
                      {
                        slug: 'plan-fixture-model',
                        display_name: 'Plan fixture model',
                        supportedReasoningEfforts: state.reducedCapabilities
                          ? [{ effort: 'low', description: 'Quick' }]
                          : [
                              { effort: 'low', description: 'Quick' },
                              { effort: 'high', description: 'Thorough' },
                            ],
                        defaultReasoningEffort: 'low',
                        ...(state.reducedCapabilities ? {} : { fastTier: 'priority' }),
                        isDefault: true,
                      },
                    ],
                  });
                if (!state.holdModels) state.finishModels();
                break;
              case 'logout':
                state.finishLogout = () => {
                  state.signedIn = false;
                  emit({
                    type: 'result',
                    account: { ...account, signedIn: false, planEnabled: false },
                  });
                };
                if (!state.holdLogout) state.finishLogout();
                break;
              case 'generate':
                emit({ type: 'delta', text: 'A plan-backed explanation.' });
                if (!state.hold)
                  emit(
                    state.fail
                      ? {
                          type: 'error',
                          message: 'ChatGPT app usage limit reached. Manage usage.',
                          reason: 'subscription_sharing_usage_limit_exceeded',
                        }
                      : { type: 'complete' },
                  );
            }
          });
        },
        disconnect: () => {},
      } as unknown as chrome.runtime.Port;
    }) as typeof chrome.runtime.connectNative;
  });
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await popup.getByLabel('Provider', { exact: true }).selectOption('chatgpt-plan');
  await expect(popup.getByPlaceholder('Optional for local models')).toHaveCount(0);
  await expect(popup.getByLabel(/Temperature/)).toHaveCount(0);
  await popup.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).click();
  await expect(
    popup.getByText('Complete sign-in in the opened tab.', { exact: true }),
  ).toBeVisible();
  await expect(popup.getByLabel('Preset', { exact: true })).toBeDisabled();
  await expect(popup.getByLabel('Provider', { exact: true })).toBeDisabled();
  await expect(popup.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
  const popupUrl = popup.url();
  await popup.close();
  popup = await context.newPage();
  await popup.goto(popupUrl);
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await popup.getByLabel('Provider', { exact: true }).selectOption('chatgpt-plan');
  await expect(popup.getByText('ChatGPT helper connected.', { exact: true })).not.toBeVisible();
  await worker.evaluate(() => {
    (
      globalThis as unknown as { planFixture: { finishLogin: () => void } }
    ).planFixture.finishLogin();
  });
  await expect(popup.getByRole('dialog', { name: "You're using your ChatGPT plan" })).toHaveCount(
    0,
  );
  await expect(popup.getByLabel('ChatGPT account', { exact: true })).toHaveValue('oaiapp_fixture');
  await expect(popup.getByText('Loading available models…', { exact: true })).toBeVisible();
  await expect(popup.getByLabel('ChatGPT model', { exact: true })).toBeDisabled();
  await expect(popup.getByLabel('Preset', { exact: true })).toBeDisabled();
  await expect(popup.getByLabel('Provider', { exact: true })).toBeDisabled();
  await worker.evaluate(() => {
    const fixture = (
      globalThis as unknown as {
        planFixture: { holdModels: boolean; finishModels: () => void };
      }
    ).planFixture;
    fixture.holdModels = false;
    fixture.finishModels();
  });
  await expect(popup.getByLabel('ChatGPT model', { exact: true })).toBeEnabled();
  await expect(popup.getByLabel('ChatGPT model', { exact: true })).toHaveValue(
    'plan-fixture-model',
  );
  await expect(popup.getByLabel('ChatGPT effort', { exact: true })).toHaveValue('low');
  await popup.getByLabel('ChatGPT effort', { exact: true }).selectOption('high');
  await popup.getByLabel('ChatGPT speed', { exact: true }).selectOption('fast');
  await popup.getByRole('button', { name: 'Test generation', exact: true }).click();
  await expect(popup.getByText(/Generation succeeded:/)).toBeVisible();
  expect(
    await worker.evaluate(() =>
      (globalThis as unknown as { planFixture: { requests: PlanRequest[] } }).planFixture.requests
        .filter((request) => request.action === 'generate')
        .at(-1),
    ),
  ).toMatchObject({
    model: 'plan-fixture-model',
    effort: 'high',
    fast: true,
  });
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(popup.getByText('Saved', { exact: true })).toBeVisible();
  await popup.screenshot({ path: testInfo.outputPath('chatgpt-settings.png'), fullPage: true });
  await popup.reload();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(popup.getByLabel('Provider', { exact: true })).toHaveValue('chatgpt-plan');
  await expect(popup.getByLabel('ChatGPT model', { exact: true })).toHaveValue(
    'plan-fixture-model',
  );
  await expect(popup.getByLabel('ChatGPT effort', { exact: true })).toHaveValue('high');
  await expect(popup.getByLabel('ChatGPT speed', { exact: true })).toHaveValue('fast');
  await worker.evaluate(() => {
    (
      globalThis as unknown as { planFixture: { reducedCapabilities: boolean } }
    ).planFixture.reducedCapabilities = true;
  });
  await popup.getByRole('button', { name: 'Refresh models', exact: true }).click();
  await expect(popup.getByRole('alert')).toContainText('saved effort');
  await expect(popup.getByRole('button', { name: 'Test generation', exact: true })).toBeDisabled();
  await expect(popup.getByLabel('ChatGPT effort', { exact: true })).toHaveValue('high');
  await expect(popup.getByLabel('ChatGPT speed', { exact: true })).toHaveValue('fast');
  await worker.evaluate(() => {
    (
      globalThis as unknown as { planFixture: { reducedCapabilities: boolean } }
    ).planFixture.reducedCapabilities = false;
  });
  await popup.getByRole('button', { name: 'Refresh models', exact: true }).click();
  await expect(popup.getByRole('button', { name: 'Test generation', exact: true })).toBeEnabled();
  const page = await context.newPage();
  await page.goto(fixtureServer.origin + '/article');
  await explainSelection(page);
  await expect.poll(async () => (await getHistory(popup))[0]?.latest.status).toBe('completed');
  const row = await getFirstHistory(popup);
  expect(row.latest.provider).toBe('chatgpt-plan');
  expect(row.latest.model).toBe('plan-fixture-model');
  expect(
    await worker.evaluate(() =>
      (globalThis as unknown as { planFixture: { requests: PlanRequest[] } }).planFixture.requests
        .filter((request) => request.action === 'generate')
        .at(-1),
    ),
  ).toMatchObject({
    model: 'plan-fixture-model',
    effort: 'high',
    fast: true,
  });
  await openFirstPageExplanation(page);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page
    .locator('summary')
    .filter({ hasText: /^Details$/ })
    .click();
  await expect(page.getByRole('link', { name: 'Manage usage' })).toBeVisible();
  await worker.evaluate(() => {
    (globalThis as unknown as { planFixture: { fail: boolean } }).planFixture.fail = true;
  });
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
  await expect.poll(async () => (await getHistory(popup))[0]?.latest.status).toBe('failed');
  expect((await getFirstHistory(popup)).latest.responseRaw).toBe('A plan-backed explanation.');
  expect((await getFirstHistory(popup)).completed?.id).toBe(row.completed?.id);
  await worker.evaluate(() => {
    (globalThis as unknown as { planFixture: { hold: boolean } }).planFixture.hold = true;
  });
  await page.getByRole('button', { name: 'Retry explanation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect.poll(async () => (await getHistory(popup))[0]?.latest.status).toBe('cancelled');
  await expect
    .poll(() =>
      worker.evaluate(
        () =>
          (globalThis as unknown as { planFixture: { cancelled: boolean } }).planFixture.cancelled,
      ),
    )
    .toBe(true);
  await worker.evaluate(() => {
    (globalThis as unknown as { planFixture: { holdLogout: boolean } }).planFixture.holdLogout =
      true;
  });
  await popup.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(popup.getByText('Signing out…', { exact: true })).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
  await worker.evaluate(() => {
    (
      globalThis as unknown as { planFixture: { finishLogout: () => void } }
    ).planFixture.finishLogout();
  });
  await expect(
    popup.getByRole('button', { name: 'Continue with ChatGPT', exact: true }),
  ).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Test generation', exact: true })).toBeDisabled();
  await popup.getByLabel('Provider', { exact: true }).selectOption('openai-compatible');
  await expect(popup.getByPlaceholder('Optional for local models')).toBeVisible();
  expect(fixtureServer.requests).toHaveLength(initialApiRequests); // No fallback to the API-key provider.
});

test('missing ChatGPT helper shows setup recovery without altering the existing provider', async ({
  sandbox,
}) => {
  const { popup } = await sandbox.launch();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await popup.getByLabel('Provider', { exact: true }).selectOption('chatgpt-plan');
  await expect(popup.getByRole('alert')).toContainText('helper');
  await expect(popup.getByText('node native/install.mjs', { exact: false })).toBeVisible();
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    popup.getByText('Choose a ChatGPT account and model.', { exact: true }),
  ).toBeVisible();
  await popup.getByLabel('Provider', { exact: true }).selectOption('openai-compatible');
  await expect(popup.getByPlaceholder('Optional for local models')).toBeVisible();
});
