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
  const { popup, worker, context } = await sandbox.launch();
  const initialApiRequests = fixtureServer.requests.length;
  // Replace only the OS transport. UI, sender validation, offscreen runner and
  // durable database are production code; no native registration or real quota.
  await worker.evaluate(() => {
    const state = {
      requests: [] as PlanRequest[],
      fail: false,
      signedIn: false,
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
                state.signedIn = true;
                emit({
                  type: 'result',
                  account: { ...account, signedIn: true, planEnabled: true },
                });
                break;
              case 'models':
                emit({
                  type: 'result',
                  models: [{ slug: 'plan-fixture-model', display_name: 'Plan fixture model' }],
                });
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
  await popup.getByRole('button', { name: 'Got it', exact: true }).click();
  await expect(popup.getByLabel('ChatGPT account', { exact: true })).toHaveValue('oaiapp_fixture');
  await popup.getByRole('button', { name: 'Refresh models', exact: true }).click();
  await expect(popup.getByLabel('ChatGPT model', { exact: true })).toHaveValue(
    'plan-fixture-model',
  );
  await popup.getByRole('button', { name: 'Test generation', exact: true }).click();
  await expect(popup.getByText(/Generation succeeded:/)).toBeVisible();
  await popup.getByRole('button', { name: 'Save Settings', exact: true }).click();
  await expect(popup.getByRole('button', { name: 'Saved!', exact: true })).toBeVisible();
  await popup.screenshot({ path: testInfo.outputPath('chatgpt-settings.png'), fullPage: true });
  await popup.reload();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(popup.getByLabel('Provider', { exact: true })).toHaveValue('chatgpt-plan');
  await expect(popup.getByLabel('ChatGPT model', { exact: true })).toHaveValue(
    'plan-fixture-model',
  );
  const page = await context.newPage();
  await page.goto(fixtureServer.origin + '/article');
  await explainSelection(page);
  await expect.poll(async () => (await getHistory(popup))[0]?.latest.status).toBe('completed');
  const row = await getFirstHistory(popup);
  expect(row.latest.provider).toBe('chatgpt-plan');
  expect(row.latest.model).toBe('plan-fixture-model');
  await openFirstPageExplanation(page);
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
  await expect(popup.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
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
  await popup.getByRole('button', { name: 'Save Settings', exact: true }).click();
  await expect(
    popup.getByText('Choose a ChatGPT account and model.', { exact: true }),
  ).toBeVisible();
  await popup.getByLabel('Provider', { exact: true }).selectOption('openai-compatible');
  await expect(popup.getByPlaceholder('Optional for local models')).toBeVisible();
});
