import { test, expect } from './fixtures.ts';
import { settingsSection } from './driver.ts';
import { installDigestProvider, openDigestReader } from './digest-fixture.ts';
import { DEFAULT_SETTINGS } from '../../src/storage/settings';
import type { ConnectionDefinition, SharedPresets } from '../../native/shared-presets-contract.mts';
import type { PlanControlRequest, PlanRequest } from '../../native/plan-protocol.mts';
import type { Worker } from '@playwright/test';

const accounts = ['bound', 'spare'].map((id) => ({
  id,
  label: 'Same email · ' + id,
  signedIn: true,
  planEnabled: true,
}));
interface Fixture {
  library: SharedPresets;
  sections: Record<string, { revision: number; value?: Record<string, unknown> }>;
  failCommit: boolean;
}
async function installSharedSummary(worker: Worker, connections: ConnectionDefinition[]) {
  await worker.evaluate(
    async ({ defaults, connections }) => {
      const previous = await chrome.storage.local.get('summary_fixture_config');
      const state: Fixture = (previous.summary_fixture_config as Fixture | undefined) ?? {
        library: { revision: 1, connections, presets: [] },
        sections: {},
        failCommit: false,
      };
      Object.assign(globalThis, { summaryConnectionFixture: state });
      if (!previous.summary_fixture_config) {
        await chrome.storage.local.set({
          summary_fixture_config: state,
          saul_user_settings: {
            ...defaults,
            connections,
            sharedCredentials: 'saul',
            sharedPresetRevision: 1,
            chatgptPlan: { accountId: 'spare', model: '' },
          },
        });
      }
      chrome.runtime.sendNativeMessage = (async (
        _host: string,
        packet: { id: string; request: PlanControlRequest },
      ) => {
        const r = packet.request;
        let result: Record<string, unknown>;
        if (r.action === 'presets-read') result = { library: state.library };
        else if (r.action === 'config-read')
          result = { config: state.sections[r.section] ?? { revision: 0 } };
        else if (r.action === 'config-save' || r.action === 'config-commit') {
          if (state.failCommit && r.action === 'config-commit')
            throw new Error('Synthetic settings storage denied');
          if ((state.sections[r.section]?.revision ?? 0) !== r.revision)
            throw new Error('Scoped settings changed');
          if (r.action === 'config-commit') {
            if (r.presetRevision !== state.library.revision)
              throw new Error('Shared settings changed');
            state.library = {
              revision: r.presetRevision + 1,
              connections: r.connections ?? state.library.connections,
              presets: r.presets,
            };
          }
          state.sections[r.section] = { revision: r.revision + 1, value: r.value };
          await chrome.storage.local.set({ summary_fixture_config: state });
          result = {
            config: state.sections[r.section],
            ...(r.action === 'config-commit' ? { library: state.library } : {}),
          };
        } else throw new Error('Unexpected summary settings operation: ' + r.action);
        return { id: packet.id, event: { type: 'result', ...result } };
      }) as typeof chrome.runtime.sendNativeMessage;
    },
    { defaults: DEFAULT_SETTINGS, connections },
  );
  await installDigestProvider(worker, false, undefined, accounts);
}
async function generations(worker: Worker) {
  return worker.evaluate(() =>
    (
      globalThis as unknown as { digestFixture: { requests: PlanRequest[] } }
    ).digestFixture.requests.filter((r) => r.action === 'generate'),
  );
}

test('built-in summary adopts the shared binding despite duplicate registrations and remembers it after browser restart', async ({
  sandbox,
  fixtureServer,
}) => {
  let browser = await sandbox.launch();
  const connections: ConnectionDefinition[] = [
    { key: 'gpt-plan', name: 'Shared plan', kind: 'chatgpt-plan', accountId: 'bound' },
  ];
  await installSharedSummary(browser.worker, connections);
  let source = await browser.context.newPage();
  await source.goto(fixtureServer.origin + '/article#first');
  let reader = await openDigestReader(browser.context, browser.popup, browser.worker, source.url());
  await expect(reader.getByRole('status')).toHaveText('Summary ready');
  expect(await generations(browser.worker)).toMatchObject([{ accountId: 'bound' }]);
  expect(
    await browser.worker.evaluate(
      async () =>
        (
          (await chrome.storage.local.get('saul_user_settings')).saul_user_settings as {
            summaryConnectionKey?: string;
          }
        ).summaryConnectionKey,
    ),
  ).toBe('gpt-plan');
  browser = await sandbox.launch();
  await installSharedSummary(browser.worker, connections);
  source = await browser.context.newPage();
  await source.goto(fixtureServer.origin + '/article#restart');
  reader = await openDigestReader(browser.context, browser.popup, browser.worker, source.url());
  await expect(reader.getByRole('status')).toHaveText('Summary ready');
  expect(await generations(browser.worker)).toMatchObject([{ accountId: 'bound' }]);
  await expect(
    reader.getByRole('combobox', { name: 'Summary connection', exact: true }),
  ).toHaveCount(0);
});

test('explicit summary choice survives save failure and blocks after permission loss until another connection is chosen', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { worker, context, popup } = await sandbox.launch();
  await installSharedSummary(worker, [
    { key: 'home', name: 'Home', kind: 'chatgpt-plan', accountId: 'bound' },
    { key: 'work', name: 'Work', kind: 'chatgpt-plan', accountId: 'spare' },
  ]);
  const source = await context.newPage();
  await source.goto(fixtureServer.origin + '/article#choose');
  let reader = await openDigestReader(context, popup, worker, source.url());
  const choice = reader.getByRole('combobox', { name: 'Summary connection', exact: true });
  await expect(choice).toBeVisible();
  await expect(choice.locator('option')).toHaveText(['Choose connection…', 'Home', 'Work']);
  await choice.selectOption('work');
  await worker.evaluate(() => {
    (
      globalThis as unknown as { summaryConnectionFixture: Fixture }
    ).summaryConnectionFixture.failCommit = true;
  });
  await reader.getByRole('button', { name: 'Start summary', exact: true }).click();
  await expect(reader.getByRole('alert')).toContainText('Synthetic settings storage denied');
  expect(await generations(worker)).toEqual([]);
  await expect(choice).toHaveValue('work');
  await reader.setViewportSize({ width: 390, height: 850 });
  await reader.screenshot({ path: info.outputPath('summary-choice-save-error.png') });
  await worker.evaluate(() => {
    (
      globalThis as unknown as { summaryConnectionFixture: Fixture }
    ).summaryConnectionFixture.failCommit = false;
  });
  await reader.getByRole('button', { name: 'Start summary', exact: true }).click();
  await expect(reader.getByRole('status')).toHaveText('Summary ready');
  expect(await generations(worker)).toMatchObject([{ accountId: 'spare' }]);
  await worker.evaluate(() => {
    (
      globalThis as unknown as { digestFixture: { accounts: typeof accounts } }
    ).digestFixture.accounts[1]!.planEnabled = false;
  });
  await source.goto(fixtureServer.origin + '/article#permission-lost');
  reader = await openDigestReader(context, popup, worker, source.url());
  await expect(reader.getByRole('alert')).toContainText('saved summary connection is unavailable');
  expect(await generations(worker)).toHaveLength(1);
  await reader.setViewportSize({ width: 390, height: 850 });
  await reader.emulateMedia({ colorScheme: 'dark' });
  await expect(
    reader
      .getByRole('combobox', { name: 'Summary connection', exact: true })
      .locator('option[value="work"]'),
  ).toHaveAttribute('disabled', '');
  expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  await reader.screenshot({ path: info.outputPath('summary-choice-unavailable-dark.png') });
  await reader
    .getByRole('combobox', { name: 'Summary connection', exact: true })
    .selectOption('home');
  await reader.getByRole('button', { name: 'Start summary', exact: true }).click();
  await expect(reader.getByRole('status')).toHaveText('Summary ready');
  expect(await generations(worker)).toMatchObject([{ accountId: 'spare' }, { accountId: 'bound' }]);
});

test('Summary connection in Settings changes the next built-in summary without retargeting saved work', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { worker, context, popup } = await sandbox.launch();
  await installSharedSummary(worker, [
    { key: 'gpt-plan', name: 'Home', kind: 'chatgpt-plan', accountId: 'bound' },
    { key: 'work', name: 'Work', kind: 'chatgpt-plan', accountId: 'spare' },
  ]);
  const source = await context.newPage();
  await source.goto(fixtureServer.origin + '/article#before-setting');
  const savedReader = await openDigestReader(context, popup, worker, source.url());
  await expect(savedReader.getByRole('status')).toHaveText('Summary ready');
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(popup, 'Summaries');
  const connection = popup.getByRole('combobox', { name: 'Summary connection', exact: true });
  await expect(connection).toHaveValue('gpt-plan');
  await connection.selectOption('work');
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(popup.getByText('Saved', { exact: true })).toBeVisible();
  await popup.screenshot({ path: info.outputPath('summary-connection-settings.png') });
  await source.goto(fixtureServer.origin + '/article#after-setting');
  const next = await openDigestReader(context, popup, worker, source.url());
  await expect(next.getByRole('status')).toHaveText('Summary ready');
  expect(await generations(worker)).toMatchObject([{ accountId: 'bound' }, { accountId: 'spare' }]);
  await savedReader.reload();
  await expect(savedReader.getByRole('status')).toHaveText('Summary ready');
  expect(await generations(worker)).toHaveLength(2);
});
