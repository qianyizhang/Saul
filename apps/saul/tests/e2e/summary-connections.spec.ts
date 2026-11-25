import type { StorageHelperRequest } from '../../shared/protocol/storage-protocol.mts';
import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures.ts';
import { reviewScreenshots } from './artifacts.ts';
import { summaryPanelDriver } from './summary-panel-driver.ts';
import { settingsSection, summaryMore } from './driver.ts';
import { installDigestProvider, openDigestReader } from './digest-fixture.ts';
import { DEFAULT_CONFIGURATION } from '../../src/configuration/definition';
import type {
  ConnectionDefinition,
  SharedPreset,
  SharedPresets,
} from '../../shared/protocol/shared-presets-contract.mts';
import type { PlanRequest } from '../../shared/protocol/credential-plan.mts';
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
  failChoiceSave: boolean;
}
async function installSharedSummary(
  worker: Worker,
  connections: ConnectionDefinition[],
  presets: SharedPreset[] = [],
  hold = false,
) {
  await worker.evaluate(
    async ({ defaults, connections, presets }) => {
      const previous = await chrome.storage.local.get('summary_fixture_config');
      const state: Fixture = (previous.summary_fixture_config as Fixture | undefined) ?? {
        library: { revision: 1, connections, presets },
        sections: {},
        failChoiceSave: false,
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
      setStorageControlFixture(
        async (_host: string, packet: { id: string; request: StorageHelperRequest }) => {
          const r = packet.request;
          let result: Record<string, unknown>;
          if (r.action === 'presets-read') result = { library: state.library };
          else if (r.action === 'config-read')
            result = { config: state.sections[r.section] ?? { revision: 0 } };
          else if (r.action === 'config-save' || r.action === 'config-commit') {
            if (state.failChoiceSave && r.action === 'config-save' && r.section === 'calls')
              return {
                id: packet.id,
                event: { type: 'error', message: 'Synthetic settings storage denied' },
              };
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
        },
      );
    },
    { defaults: DEFAULT_CONFIGURATION, connections, presets },
  );
  await installDigestProvider(worker, hold, undefined, accounts);
}
async function generations(worker: Worker) {
  return worker.evaluate(() =>
    (
      globalThis as unknown as { digestFixture: { requests: PlanRequest[] } }
    ).digestFixture.requests.filter((r) => r.action === 'generate'),
  );
}

const home = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Home Luna',
  model: 'gpt-6-luna',
  effort: 'medium',
  fast: false,
  connectionKey: 'gpt-plan',
};
const work = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Work careful reading',
  model: 'fixture-work-model',
  effort: 'high',
  fast: true,
  connectionKey: 'work',
};
const connections: ConnectionDefinition[] = [
  { key: 'gpt-plan', name: 'Home', kind: 'chatgpt-plan', accountId: 'bound' },
  { key: 'work', name: 'Work', kind: 'chatgpt-plan', accountId: 'spare' },
];

test('built-in summary reviews changed setup before starting and remembers its preset after restart', async ({
  sandbox,
  fixtureServer,
}, info) => {
  let browser = await sandbox.launch();
  await installSharedSummary(browser.worker, connections, [home]);
  let source = await browser.context.newPage();
  await source.goto(fixtureServer.origin + '/article#first');
  let reader = await openDigestReader(browser.context, browser.popup, browser.worker, source.url());
  const choice = reader.getByRole('combobox', { name: 'Write preset', exact: true });
  await expect(choice).toHaveValue('');
  await expect(choice.getByRole('option', { name: home.name, exact: true })).toHaveCount(1);
  await expect(choice.getByRole('option', { name: 'Current', exact: true })).toHaveCount(0);
  if (reviewScreenshots)
    await reader.screenshot({ path: info.outputPath('call-setup-picker.png') });
  expect(await generations(browser.worker)).toEqual([]);
  await choice.selectOption(home.id);
  await source.goto(fixtureServer.origin + '/article#changed');
  const start = reader.getByRole('button', { name: 'Save and start', exact: true });
  await start.click();
  await expect(reader.getByRole('status')).toContainText('The source or Call settings changed');
  await expect(reader.getByRole('link', { name: source.url() })).toBeVisible();
  if (reviewScreenshots)
    await reader.screenshot({ path: info.outputPath('call-setup-changed.png') });
  expect(await generations(browser.worker)).toEqual([]);
  await expect(choice).toHaveValue(home.id);
  await start.click();
  await expect(reader.getByRole('status')).toHaveText('Summary ready');
  expect(await generations(browser.worker)).toMatchObject([{ accountId: 'bound' }]);
  browser = await sandbox.launch();
  await installSharedSummary(browser.worker, connections, [home]);
  source = await browser.context.newPage();
  await source.goto(fixtureServer.origin + '/article#restart');
  reader = await openDigestReader(browser.context, browser.popup, browser.worker, source.url());
  await expect(reader.getByRole('status')).toHaveText('Summary ready');
  expect(await generations(browser.worker)).toMatchObject([{ accountId: 'bound' }]);
  await expect(reader.getByRole('combobox', { name: 'Write preset' })).toHaveCount(0);
});

test('changed window setup shows the new preset and lists sources in run order before Continue', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { worker, context, popup } = await sandbox.launch();
  await installSharedSummary(worker, connections, [home, work]);
  const first = await context.newPage();
  await first.goto(fixtureServer.origin + '/article#first');
  const second = await context.newPage();
  await second.goto(fixtureServer.origin + '/article#second');
  const reader = await openDigestReader(context, popup, worker, [second.url(), first.url()]);
  await reader.getByRole('combobox', { name: 'Write preset' }).selectOption(home.id);
  const settings = await context.newPage();
  await settings.goto(new URL('/library.html?section=calls#settings', popup.url()).href);
  const model = settings.getByLabel('Model preset', { exact: true });
  await model.selectOption(work.id);
  await expect(model).toHaveValue(work.id);
  await reader.getByRole('button', { name: 'Save and start' }).click();
  const setup = reader.getByRole('region', { name: 'Call setup' });
  await expect(setup.getByRole('status')).toContainText('The source or Call settings changed');
  await expect(setup).toContainText(work.name);
  await expect(setup).toContainText(work.model);
  await expect(
    setup.getByRole('list', { name: 'Sources in run order' }).getByRole('link'),
  ).toHaveText([second.url(), first.url()]);
  expect(await generations(worker)).toEqual([]);
  await reader.setViewportSize({ width: 390, height: 850 });
  await reader.emulateMedia({ colorScheme: 'dark' });
  expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  if (reviewScreenshots)
    await reader.screenshot({ path: info.outputPath('call-setup-changed-window.png') });
  await setup.getByRole('button', { name: 'Continue' }).click();
  await expect(reader.getByRole('status')).toContainText('2 of 2 summarized');
  expect(await generations(worker)).toMatchObject([
    { accountId: 'spare', model: work.model },
    { accountId: 'spare', model: work.model },
  ]);
});

test('Write setup retains the choice on save failure and opens the broken preset directly', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { worker, context, popup } = await sandbox.launch();
  await installSharedSummary(worker, connections, [home, work]);
  const source = await context.newPage();
  await source.goto(fixtureServer.origin + '/article#choose');
  let reader = await openDigestReader(context, popup, worker, source.url());
  const choice = reader.getByRole('combobox', { name: 'Write preset', exact: true });
  await expect(choice).toBeVisible();
  for (const name of [home.name, work.name])
    await expect(choice.getByRole('option', { name, exact: true })).toHaveCount(1);
  await choice.selectOption(work.id);
  await worker.evaluate(() => {
    (
      globalThis as unknown as { summaryConnectionFixture: Fixture }
    ).summaryConnectionFixture.failChoiceSave = true;
  });
  await reader.getByRole('button', { name: 'Save and start', exact: true }).click();
  await expect(reader.getByRole('alert')).toContainText('Synthetic settings storage denied');
  expect(await generations(worker)).toEqual([]);
  await expect(choice).toHaveValue(work.id);
  await reader.setViewportSize({ width: 390, height: 850 });
  await reader.screenshot({ path: info.outputPath('summary-choice-save-error.png') });
  await worker.evaluate(() => {
    (
      globalThis as unknown as { summaryConnectionFixture: Fixture }
    ).summaryConnectionFixture.failChoiceSave = false;
  });
  await choice.focus();
  await reader.keyboard.press('Tab');
  await expect(reader.getByRole('button', { name: 'Save and start', exact: true })).toBeFocused();
  await reader.keyboard.press('Enter');
  await expect(reader.getByRole('status')).toHaveText('Summary ready');
  expect(await generations(worker)).toMatchObject([{ accountId: 'spare' }]);
  await worker.evaluate(() => {
    (
      globalThis as unknown as { digestFixture: { accounts: typeof accounts } }
    ).digestFixture.accounts[1]!.planEnabled = false;
  });
  await source.goto(fixtureServer.origin + '/article#permission-lost');
  reader = await openDigestReader(context, popup, worker, source.url());
  await expect(reader.getByRole('alert')).toContainText(work.name);
  await expect(reader.getByRole('button', { name: 'Return to source' })).toBeVisible();
  expect(await generations(worker)).toHaveLength(1);
  await reader.setViewportSize({ width: 390, height: 850 });
  await reader.emulateMedia({ colorScheme: 'dark' });
  await expect(reader.getByRole('combobox', { name: 'Write preset' })).toHaveCount(0);
  expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  await reader.screenshot({ path: info.outputPath('summary-choice-unavailable-dark.png') });
  await worker.evaluate(() => chrome.storage.local.set({ saul_minimum_mode: false }));
  await expect(reader.locator('main')).toHaveAttribute('data-minimum', 'false');
  await expect(reader.getByRole('link', { name: 'Edit preset' })).toBeVisible();
  if (reviewScreenshots)
    await reader.screenshot({ path: info.outputPath('call-setup-repair-standard.png') });
  const opened = context.waitForEvent('page');
  await reader.getByRole('link', { name: 'Edit preset' }).click();
  const settings = await opened;
  await expect(settings.getByRole('region', { name: 'Presets', exact: true })).toBeVisible();
  await expect(settings.getByLabel('ChatGPT model', { exact: true })).toHaveValue(work.model);
  await expect(settings.getByLabel('Connection', { exact: true })).toHaveValue(work.connectionKey);
  await worker.evaluate(() => {
    (
      globalThis as unknown as { digestFixture: { accounts: typeof accounts } }
    ).digestFixture.accounts[1]!.planEnabled = true;
  });
  await reader.reload();
  await expect(reader.getByRole('link', { name: 'Edit preset' })).toBeVisible();
  expect(await generations(worker)).toHaveLength(1);
  await reader.bringToFront();
  await reader.getByRole('button', { name: 'Return to source' }).click();
  await expect
    .poll(() =>
      worker.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        return tabs.some((tab) => tab.url === url);
      }, source.url()),
    )
    .toBe(true);
  expect(await generations(worker)).toHaveLength(1);
});

test('reopening the same native panel restores pending setup after a preset becomes ready', async ({
  sandbox,
  fixtureServer,
}) => {
  const { worker, context, popup } = await sandbox.launch();
  await installSharedSummary(worker, connections, [home]);
  const source = await context.newPage();
  await source.goto(fixtureServer.origin + '/article');
  const windowId = await worker.evaluate(
    async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)!.windowId,
    source.url(),
  );
  const panelCount = () =>
    worker.evaluate(
      async () => (await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).length,
    );
  await popup.getByRole('button', { name: 'Window', exact: true }).click();
  await popup
    .getByRole('checkbox', { name: 'Select Calculus reading fixture', exact: true })
    .check();
  await popup.getByRole('button', { name: 'Summarize', exact: true }).click();
  await expect.poll(panelCount).toBe(1);
  let panel = await summaryPanelDriver(context);
  try {
    const hasPicker = () =>
      panel.evaluate(() => Boolean(document.querySelector('[name="preset"]')));
    await expect.poll(hasPicker).toBe(true);
    await panel.click('Close summary panel');
    await expect.poll(panelCount).toBe(0);
    await panel.detach();

    await popup.getByRole('button', { name: 'Settings', exact: true }).click();
    await settingsSection(popup, 'Calls');
    const model = popup.getByLabel('Model preset', { exact: true });
    await model.selectOption(home.id);
    await expect(model).toHaveValue(home.id);
    await popup.evaluate((windowId) => {
      const reopen = document.createElement('button');
      reopen.textContent = 'Reopen saved panel route';
      reopen.addEventListener('click', () => void chrome.sidePanel.open({ windowId }));
      document.body.append(reopen);
    }, windowId);
    await popup.getByRole('button', { name: 'Reopen saved panel route' }).click();
    await expect.poll(panelCount).toBe(1);
    panel = await summaryPanelDriver(context);
    await expect.poll(hasPicker).toBe(true);
    expect(await generations(worker)).toEqual([]);

    await popup.getByRole('button', { name: 'Window', exact: true }).click();
    await popup
      .getByRole('checkbox', { name: 'Select Calculus reading fixture', exact: true })
      .check();
    await popup.getByRole('button', { name: 'Summarize', exact: true }).click();
    await expect
      .poll(() => panel.evaluate(() => document.querySelector('[role="status"]')?.textContent))
      .toBe('Summary ready');
    expect(await generations(worker)).toHaveLength(1);
  } finally {
    await panel.detach();
  }
});

test('Calls saves the model and its bound connection; Retry stays frozen and Run again uses the new preset', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { worker, context, popup } = await sandbox.launch();
  await installSharedSummary(worker, connections, [home, work], true);
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(popup, 'Calls');
  await expect(popup.getByLabel('Call preset', { exact: true })).toHaveValue('');
  await expect(popup.getByLabel('Summary connection', { exact: true })).toHaveCount(0);
  const model = popup.getByLabel('Model preset', { exact: true });
  await expect(model).toHaveValue('');
  await model.selectOption(home.id);
  await expect(model).toHaveValue(home.id);

  const source = await context.newPage();
  await source.goto(fixtureServer.origin + '/article#preset');
  const reader = await openDigestReader(context, popup, worker, source.url());
  await expect
    .poll(() => generations(worker))
    .toMatchObject([
      { accountId: 'bound', model: home.model, effort: home.effort, fast: home.fast },
    ]);
  await reader.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(reader.getByRole('status')).toHaveText('Summary stopped');

  const workspace = await context.newPage();
  await workspace.goto(new URL('/library.html#settings', popup.url()).href);
  await settingsSection(workspace, 'Calls');
  const workspaceModel = workspace.getByLabel('Model preset', { exact: true });
  await expect(workspaceModel).toHaveValue(home.id);
  await workspaceModel.selectOption(work.id);
  await expect(workspaceModel).toHaveValue(work.id);
  if (process.env.SAUL_CAPTURE_REVIEW === '1')
    await workspace.screenshot({ path: info.outputPath('calls-workspace.png') });

  await worker.evaluate(() => {
    (globalThis as unknown as { digestFixture: { hold: boolean } }).digestFixture.hold = false;
  });
  await reader.getByRole('button', { name: 'Retry unfinished' }).click();
  await expect(reader.getByRole('status')).toHaveText('Summary ready');
  await summaryMore(reader);
  await reader.getByRole('button', { name: 'Run again', exact: true }).click();
  await expect
    .poll(() => generations(worker))
    .toMatchObject([
      { accountId: 'bound', model: home.model, effort: home.effort, fast: home.fast },
      { accountId: 'bound', model: home.model, effort: home.effort, fast: home.fast },
      { accountId: 'spare', model: work.model, effort: work.effort, fast: work.fast },
    ]);
  await expect(reader.getByRole('status')).toHaveText('Summary ready');
  await reader.getByText('Details', { exact: true }).click();
  const modelLabel = `${work.name} · ${work.model} ${work.effort}`;
  await expect(reader.getByText(modelLabel, { exact: false })).toBeVisible();
  const downloading = reader.waitForEvent('download');
  await summaryMore(reader);
  await reader.getByRole('button', { name: 'Export HTML' }).click();
  const exported = await readFile((await (await downloading).path())!, 'utf8');
  expect(exported).toContain(modelLabel);
  expect(exported).not.toContain(home.model);

  await worker.evaluate((id) => {
    const state = (globalThis as unknown as { summaryConnectionFixture: Fixture })
      .summaryConnectionFixture;
    state.library.presets = state.library.presets.filter((preset) => preset.id !== id);
    state.library.revision++;
  }, work.id);
  await workspace.reload();
  await settingsSection(workspace, 'Calls');
  await expect(workspace.getByLabel('Model preset', { exact: true })).toHaveValue(work.id);
  await expect(workspace.getByRole('option', { name: 'Unavailable preset' })).toHaveAttribute(
    'disabled',
    '',
  );
  await source.goto(fixtureServer.origin + '/article#preset-removed');
  const blocked = await openDigestReader(context, popup, worker, source.url());
  await expect(blocked.getByRole('alert')).toBeVisible();
  await expect(blocked.getByRole('link', { name: 'Open Calls' })).toBeVisible();
  expect(await generations(worker)).toHaveLength(3);
});
