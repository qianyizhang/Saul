import type { StorageHelperRequest } from '../../shared/protocol/storage-protocol.mts';
import { readingMore } from './driver.ts';
import { settingsSection } from './driver.ts';
import { reviewScreenshots } from './artifacts.ts';
import { test, expect } from './fixtures.ts';
import {
  explainSelection,
  getHistory,
  getFirstHistory,
  openFirstPageExplanation,
} from './driver.ts';
import type { PlanRequest, PlanEvent } from '../../shared/protocol/credential-plan.mts';
import { DEFAULT_CONFIGURATION, type Configuration } from '../../src/configuration/definition';
import type {
  CredentialRequest,
  CredentialEvent,
} from '../../shared/protocol/credentials-contract.mts';
import {
  DEFAULT_CONNECTIONS,
  type SharedPresets,
} from '../../shared/protocol/shared-presets-contract.mts';

test('ChatGPT provider settings route signed-owner reading streams, preserve partial failures, and stop', async ({
  sandbox,
  fixtureServer,
}, testInfo) => {
  const { worker, context, popup: initialPopup } = await sandbox.launch();
  const popup = initialPopup;
  const initialApiRequests = fixtureServer.requests.length;
  // Replace only the OS transport. UI, sender validation, offscreen runner and
  // durable database are production code; no native registration or real quota.
  await worker.evaluate(
    async ({ connections, defaults }) => {
      const saved =
        ((await chrome.storage.local.get('saul_user_settings'))
          .saul_user_settings as Configuration) || defaults;
      await chrome.storage.local.set({
        saul_user_settings: { ...saved, sharedCredentials: 'saul' },
      });
      let library: SharedPresets = { revision: 0, presets: [], connections };
      const sections: Record<string, { revision: number; value?: Record<string, unknown> }> = {};
      setStorageControlFixture(
        async (host: string, message: { id: string; request: StorageHelperRequest }) => {
          if (host !== 'com.saul.chatgpt')
            throw new Error('Configuration must use the storage helper');
          const request = message.request;
          if (request.action === 'config-commit') {
            if (
              request.revision !== (sections[request.section]?.revision || 0) ||
              request.presetRevision !== library.revision
            )
              return {
                id: message.id,
                event: { type: 'error', message: 'Settings changed. Reload saved settings.' },
              };
            sections[request.section] = { revision: request.revision + 1, value: request.value };
            library = {
              revision: library.revision + 1,
              presets: request.presets,
              connections: request.connections || library.connections,
            };
            return {
              id: message.id,
              event: { type: 'result', config: sections[request.section], library },
            };
          }
          if (request.action === 'config-read')
            return {
              id: message.id,
              event: { type: 'result', config: sections[request.section] || { revision: 0 } },
            };
          if (request.action === 'config-save') {
            if (request.revision !== (sections[request.section]?.revision || 0))
              return {
                id: message.id,
                event: { type: 'error', message: 'Scoped settings changed.' },
              };
            sections[request.section] = { revision: request.revision + 1, value: request.value };
            return { id: message.id, event: { type: 'result', config: sections[request.section] } };
          }
          if (request.action === 'presets-save') {
            if (request.revision !== library.revision)
              return {
                id: message.id,
                event: { type: 'error', message: 'Shared presets changed. Reload saved settings.' },
              };
            library = {
              revision: library.revision + 1,
              presets: request.presets,
              connections: request.connections || library.connections,
            };
          } else if (request.action === 'presets-import') {
            library = {
              revision: library.revision + 1,
              presets: [...library.presets, ...request.presets],
              connections: library.connections,
            };
          }
          return { id: message.id, event: { type: 'result', library } };
        },
      );
      const state = {
        requests: [] as CredentialRequest[],
        fail: false,
        signedIn: true,
        cancelled: false,
        hold: false,
        phased: false,
        sendGeneration: (_event: PlanEvent) => {},
      };
      Object.assign(globalThis, { planFixture: state });
      const original = chrome.runtime.connectNative.bind(chrome.runtime);
      chrome.runtime.connectNative = ((host: string) => {
        if (host !== 'com.saul.credentials') return original(host);
        const listeners: ((m: { id: string; event: CredentialEvent }) => void)[] = [];
        return {
          onMessage: {
            addListener: (fn: (m: { id: string; event: CredentialEvent }) => void) =>
              listeners.push(fn),
          },
          onDisconnect: { addListener: () => {} },
          postMessage: (message: {
            version: number;
            id: string;
            request: CredentialRequest;
            cancel?: boolean;
          }) => {
            if (message.cancel) {
              state.cancelled = true;
              return;
            }
            if (message.version !== 2) throw new Error('Expected signed credential protocol v2');
            state.requests.push(message.request);
            const emit = (event: CredentialEvent) =>
              listeners.forEach((fn) => fn({ id: message.id, event }));
            const account = {
              id: 'oaiapp_fixture',
              label: 'Fixture account · fixture',
              signedIn: state.signedIn,
              planEnabled: state.signedIn,
            };
            queueMicrotask(() => {
              switch (message.request.action) {
                case 'status':
                case 'api-key-status':
                  emit({ type: 'result', accounts: [account], apiConnected: false });
                  break;
                case 'connection-status':
                  emit({
                    type: 'result',
                    connection: {
                      connected: state.signedIn,
                      identity: account.label,
                      signedIn: state.signedIn,
                    },
                  });
                  break;
                case 'connection-catalog':
                  emit({
                    type: 'result',
                    catalog: {
                      fetchedAt: Date.now() / 1000,
                      models: [
                        {
                          id: 'plan-fixture-model',
                          name: 'Plan fixture model',
                          capabilities: ['write'],
                          efforts: ['low', 'high'],
                          defaultEffort: 'low',
                          fastTier: 'priority',
                        },
                      ],
                    },
                  });
                  break;
                case 'accounts':
                  emit({ type: 'result', accounts: [account] });
                  break;
                case 'logout':
                  state.signedIn = false;
                  emit({
                    type: 'result',
                    account: { ...account, signedIn: false, planEnabled: false },
                  });
                  break;
                case 'generate':
                  state.sendGeneration = emit;
                  if (state.phased) return;
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
    },
    {
      defaults: DEFAULT_CONFIGURATION,
      connections: DEFAULT_CONNECTIONS.map((c) =>
        c.key === 'gpt-plan' ? { ...c, accountId: 'oaiapp_fixture' } : c,
      ),
    },
  );
  await popup.reload();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(popup, 'Presets');
  await popup.getByLabel('Connection', { exact: true }).selectOption('gpt-plan');
  await popup.getByLabel('ChatGPT model', { exact: true }).selectOption('plan-fixture-model');
  await popup
    .locator('summary')
    .filter({ hasText: /^Options$/ })
    .click();
  await popup.getByRole('combobox', { name: /^Effort/ }).selectOption('high');
  await popup.getByRole('combobox', { name: /^Speed/ }).selectOption('true');
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(popup.getByText('Saved', { exact: true })).toBeVisible();
  await popup.reload();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(popup, 'Presets');
  await expect(popup.getByLabel('Connection', { exact: true })).toHaveValue('gpt-plan');
  await expect(popup.getByLabel('ChatGPT model', { exact: true })).toHaveValue(
    'plan-fixture-model',
  );
  await popup
    .locator('summary')
    .filter({ hasText: /^Options$/ })
    .click();
  await expect(popup.getByRole('combobox', { name: /^Effort/ })).toHaveValue('high');
  await expect(popup.getByRole('combobox', { name: /^Speed/ })).toHaveValue('true');
  const page = await context.newPage();
  await page.goto(fixtureServer.origin + '/article');
  await worker.evaluate(() => {
    (globalThis as unknown as { planFixture: { phased: boolean } }).planFixture.phased = true;
  });
  await explainSelection(page);
  await openFirstPageExplanation(page);
  const card = page.getByRole('region', { name: 'Saul explanation' });
  const send = (event: PlanEvent) =>
    worker.evaluate((event) => {
      (
        globalThis as unknown as { planFixture: { sendGeneration: (event: PlanEvent) => void } }
      ).planFixture.sendGeneration(event);
    }, event);
  await expect(card.getByRole('status')).toHaveText('Connecting…');
  await send({ type: 'activity', phase: 'waiting' });
  await expect(card.getByRole('status')).toHaveText('Waiting for answer…');
  await send({ type: 'activity', phase: 'thinking' });
  await expect(card.getByRole('status')).toHaveText('Thinking…');
  if (reviewScreenshots) await card.screenshot({ path: testInfo.outputPath('thinking-light.png') });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 720 });
  await expect
    .poll(() =>
      card
        .locator('.saul-activity-divider')
        .evaluate((el) => getComputedStyle(el, '::after').animationName),
    )
    .toBe('none');
  if (reviewScreenshots)
    await card.screenshot({ path: testInfo.outputPath('thinking-dark-reduced-motion.png') });
  await send({ type: 'delta', text: 'A' });
  await expect(card.locator('.saul-reading')).toHaveText('A');
  await send({ type: 'delta', text: ' plan-backed explanation.' });
  // Nothing further arrives. The tail must still become visible before Stop/completion.
  await expect(card.locator('.saul-reading')).toHaveText('A plan-backed explanation.');
  await expect(card.getByRole('status')).toHaveText('Generating response…');
  await expect(card.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await send({ type: 'complete' });
  await expect(card.getByRole('status')).toHaveText('Saved');
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await worker.evaluate(() => {
    (globalThis as unknown as { planFixture: { phased: boolean } }).planFixture.phased = false;
  });
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
    connectionKey: 'gpt-plan',
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
  await readingMore(page);
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
  await settingsSection(popup, 'Connections');
  const connection = popup.getByRole('article', { name: 'ChatGPT plan', exact: true });
  await connection.getByLabel('More for ChatGPT plan').click();
  popup.once('dialog', (dialog) => dialog.accept());
  await connection.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(connection.getByRole('status')).toHaveText('Signed out');
  expect(fixtureServer.requests).toHaveLength(initialApiRequests); // No API-key fallback.
});

test('missing signed credential helper preserves local settings and offers Integrations recovery', async ({
  sandbox,
}) => {
  const { popup, worker } = await sandbox.launch();
  const saved = () =>
    worker.evaluate(
      async () => (await chrome.storage.local.get('saul_user_settings')).saul_user_settings,
    );
  const before = await saved();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(popup, 'Preferences');
  await popup.getByText('Integrations', { exact: true }).click();
  await popup.getByRole('button', { name: 'Connect to Saul', exact: true }).click();
  await expect(
    popup.getByRole('alert').filter({ hasText: 'signed Saul credential helper' }),
  ).toBeVisible();
  expect(await saved()).toEqual(before);
  await expect(popup.getByRole('button', { name: 'Connect to Saul', exact: true })).toBeVisible();
});
