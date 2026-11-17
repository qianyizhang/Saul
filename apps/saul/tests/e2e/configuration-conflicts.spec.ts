import { settingsSection } from './driver.ts';
import { reviewScreenshots } from './artifacts.ts';
import { test, expect } from './fixtures.ts';
import { DEFAULT_CONFIGURATION } from '../../src/configuration/definition';
import type { Configuration } from '../../src/configuration/definition';
import { installDigestProvider } from './digest-fixture';
import type { PlanControlRequest } from '../../native/plan-protocol.mts';
import type { SharedPresets } from '../../native/shared-presets-contract.mts';

test('bound plan inspection and model edits keep the standalone account separate', async ({
  sandbox,
}, info) => {
  const { popup, worker } = await sandbox.launch();
  await installDigestProvider(
    worker,
    false,
    undefined,
    ['local-A', 'bound-B', 'explicit-C'].map((id) => ({
      id,
      label: id,
      signedIn: true,
      planEnabled: true,
    })),
  );
  await worker.evaluate(async (defaults) => {
    let library: SharedPresets = {
      revision: 1,
      connections: [
        ...defaults.connections,
        { key: 'bound-plan', name: 'Bound plan', kind: 'chatgpt-plan', accountId: 'bound-B' },
      ],
      presets: [
        {
          id: 'c14b29f3-3ec2-4efc-8bed-e05531aef2cb',
          name: 'Bound plan preset',
          connectionKey: 'bound-plan',
          model: 'gpt-6-luna',
          effort: '',
          fast: false,
        },
      ],
    };
    let config: { revision: number; value?: Record<string, unknown> } = { revision: 0 };
    await chrome.storage.local.set({
      saul_user_settings: {
        ...defaults,
        sharedPresetRevision: 1,
        chatgptPlan: { accountId: 'local-A', model: 'saved-model' },
      },
    });
    chrome.runtime.sendNativeMessage = (async (
      _host: string,
      message: { id: string; request: PlanControlRequest },
    ) => {
      const r = message.request;
      if (r.action === 'presets-read')
        return { id: message.id, event: { type: 'result', library } };
      if (r.action === 'config-save' || r.action === 'config-commit') {
        if (
          r.revision !== config.revision ||
          (r.action === 'config-commit' && r.presetRevision !== library.revision)
        )
          throw new Error('Stale fixture revision');
        config = { revision: config.revision + 1, value: r.value };
        if (r.action === 'config-commit')
          library = {
            revision: library.revision + 1,
            connections: r.connections ?? library.connections,
            presets: r.presets,
          };
      } else if (r.action !== 'config-read') throw new Error('Unexpected fixture request');
      return { id: message.id, event: { type: 'result', config, library } };
    }) as typeof chrome.runtime.sendNativeMessage;
  }, DEFAULT_CONFIGURATION);
  await popup.reload();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(popup, 'Presets');
  await popup.getByRole('button', { name: 'Bound plan preset', exact: true }).click();
  await expect(popup.getByLabel('ChatGPT model', { exact: true })).toBeEnabled();
  await expect(popup.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  await settingsSection(popup, 'Actions');
  await popup.getByLabel('Response language', { exact: true }).selectOption('Chinese');
  const save = async () => {
    await popup.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(popup.getByText('Saved', { exact: true })).toBeVisible();
  };
  const account = () =>
    worker.evaluate(
      async () =>
        ((await chrome.storage.local.get('saul_user_settings')).saul_user_settings as Configuration)
          .chatgptPlan?.accountId,
    );
  await save();
  expect(await account()).toBe('local-A');
  await settingsSection(popup, 'Presets');
  await popup.getByLabel('Model options', { exact: true }).click();
  await popup.getByLabel('ChatGPT effort', { exact: true }).selectOption('medium');
  await save();
  expect(await account()).toBe('local-A');
  await settingsSection(popup, 'Connections');
  await expect(popup.getByLabel('ChatGPT account', { exact: true })).toHaveValue('local-A');
  await popup.getByLabel('ChatGPT account', { exact: true }).selectOption('explicit-C');
  await save();
  expect(await account()).toBe('explicit-C');
  await settingsSection(popup, 'Presets');
  await expect(popup.getByLabel('ChatGPT effort', { exact: true })).toHaveValue('medium');
  if (reviewScreenshots)
    await popup.screenshot({ path: info.outputPath('bound-plan-inspection.png') });
});

test('preset inspection stays clean through an unrelated save and stale-save review', async ({
  sandbox,
  fixtureServer,
}) => {
  const { popup, worker, context } = await sandbox.launch();
  const source = structuredClone(DEFAULT_CONFIGURATION);
  source.activeProfileId = 'default';
  source.openaiCompatible = {
    ...source.openaiCompatible,
    baseUrl: fixtureServer.origin + '/v1',
    model: 'saved-default',
  };
  source.chatgptPlan = { accountId: 'saved-local-account', model: 'saved-plan-model' };
  source.profiles = [
    { id: 'default', name: 'Default', config: { ...source.openaiCompatible } },
    {
      id: 'other',
      name: 'Other',
      config: { ...source.openaiCompatible, baseUrl: fixtureServer.origin + '/other/v1' },
    },
  ];
  source.configuration!.presets.push({
    id: 'other',
    name: 'Other preset',
    provider: 'openai-compatible',
    profileId: 'other',
    model: 'inspected-model',
  });
  source.configuration!.presets.push(
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `spare-${index}`,
      name: `Spare ${index}`,
      provider: 'openai-compatible' as const,
      profileId: 'default',
      model: 'saved-default',
    })),
  );
  await worker.evaluate(
    (settings) => chrome.storage.local.set({ saul_user_settings: settings }),
    source,
  );
  await popup.reload();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(popup, 'Presets');
  await popup.getByLabel('Find a preset', { exact: true }).fill('Other');
  await popup.getByRole('button', { name: 'Other preset', exact: true }).click();
  await expect(popup.getByLabel('Model name', { exact: true })).toHaveValue('inspected-model');
  await expect(popup.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  const other = await context.newPage();
  await other.goto(popup.url().replace('popup.html', 'library.html'));
  await settingsSection(other, 'Actions');
  await other.getByLabel('Edit actions', { exact: true }).click();
  await other.getByLabel('Response language', { exact: true }).selectOption('English');
  await settingsSection(popup, 'Actions');
  await popup.getByLabel('Edit actions', { exact: true }).click();
  await popup.getByLabel('Response language', { exact: true }).selectOption('Chinese');
  await other.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(other.getByText('Saved', { exact: true })).toBeVisible();
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(popup.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await popup.getByRole('button', { name: 'Review latest', exact: true }).click();
  await expect(popup.getByRole('group')).toHaveCount(1);
  await popup.getByRole('radio', { name: 'Mine', exact: true }).check();
  await popup.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(popup.getByText('Saved', { exact: true })).toBeVisible();
  await settingsSection(popup, 'Presets');
  await expect(popup.getByLabel('Preset', { exact: true })).toHaveValue('other');
  await expect(popup.getByLabel('Find a preset', { exact: true })).toHaveValue('Other');
  await expect(popup.getByLabel('Model name', { exact: true })).toHaveValue('inspected-model');
  const saved = await worker.evaluate(
    async () =>
      (await chrome.storage.local.get('saul_user_settings')).saul_user_settings as Configuration,
  );
  expect(saved.openaiCompatible).toEqual(source.openaiCompatible);
  expect(saved.activeProfileId).toBe(source.activeProfileId);
  expect(saved.chatgptPlan).toEqual(source.chatgptPlan);
  expect(saved.configuration?.selectedRecipeId).toBe(source.configuration!.selectedRecipeId);
  expect(saved.responseLanguage).toBe('Chinese');
});

test('two Settings surfaces retain a stale draft until deliberate reload', async ({
  sandbox,
}, info) => {
  const { popup, context } = await sandbox.launch();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(popup, 'Presets');
  const other = await context.newPage();
  await other.goto(popup.url().replace('popup.html', 'library.html'));
  await settingsSection(other, 'Presets');
  await expect(other.getByLabel('Model name', { exact: true })).toBeVisible();
  await settingsSection(popup, 'Actions');
  await popup.getByLabel('Edit actions', { exact: true }).click();
  await popup.getByLabel('Action name', { exact: true }).fill('Saved in first surface');
  await settingsSection(other, 'Actions');
  await other.getByLabel('Edit actions', { exact: true }).click();
  await other.getByLabel('Edit action', { exact: true }).selectOption('recipe-lookup');
  await other.getByLabel('Prompt template', { exact: true }).fill('Keep this draft: {{text}}');
  await other.getByLabel('Response language', { exact: true }).selectOption('Chinese');
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(popup.getByText('Saved', { exact: true })).toBeVisible();
  await other.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(other.getByRole('alert')).toContainText('Settings changed in another surface');
  await expect(other.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(other.getByLabel('Edit action', { exact: true })).toHaveValue('recipe-lookup');
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
    await settingsSection(other, 'Preferences');
    await other.getByRole('checkbox', { name: 'Min Mode', exact: true }).setChecked(minimum);
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
        if (reviewScreenshots)
          await other.screenshot({
            path: info.outputPath(
              `conflict-${minimum ? 'minimum' : 'standard'}-${width}-${colorScheme}.png`,
            ),
          });
      }
    }
  }
  await settingsSection(other, 'Actions');
  other.once('dialog', (dialog) => dialog.dismiss());
  const reload = other.getByRole('button', { name: 'Reload saved settings', exact: true });
  await reload.focus();
  await other.keyboard.press('Enter');
  await expect(other.getByLabel('Prompt template', { exact: true })).toHaveValue(
    'Keep this draft: {{text}}',
  );
  other.once('dialog', (dialog) => dialog.accept());
  await other.getByRole('button', { name: 'Reload saved settings', exact: true }).click();
  await expect(other.getByLabel('Action name', { exact: true })).toHaveValue(
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
  await settingsSection(popup, 'Actions');
  await popup.getByLabel('Edit actions', { exact: true }).click();
  await popup.getByLabel('Action name', { exact: true }).fill('Saved but acknowledgement lost');
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
  await expect(popup.getByLabel('Action name', { exact: true })).toHaveValue(
    'Saved but acknowledgement lost',
  );
  await expect(popup.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  expect(
    await popup.evaluate(
      () => (globalThis as typeof globalThis & { commitCount?: number }).commitCount,
    ),
  ).toBe(1);
  await expect(popup.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await popup.getByRole('button', { name: 'Review latest', exact: true }).click();
  await expect(
    popup.getByText('Your edits already match the saved values.', { exact: true }),
  ).toBeVisible();
  await popup.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  await expect(popup.getByRole('alert')).toHaveCount(0);
  await expect(popup.getByLabel('Action name', { exact: true })).toHaveValue(
    'Saved but acknowledgement lost',
  );
  await expect(popup.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  expect(
    await popup.evaluate(
      () => (globalThis as typeof globalThis & { commitCount?: number }).commitCount,
    ),
  ).toBe(1);
});

test('review latest keeps edits through read failure and cancel, resolves fields, then saves explicitly', async ({
  sandbox,
}, info) => {
  const { popup, context } = await sandbox.launch();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(popup, 'Actions');
  await popup.getByLabel('Edit actions', { exact: true }).click();
  const other = await context.newPage();
  await other.goto(popup.url().replace('popup.html', 'library.html'));
  await settingsSection(other, 'Actions');
  await other.getByLabel('Edit actions', { exact: true }).click();
  await other.getByLabel('Action name', { exact: true }).fill('My reading');
  await other.getByLabel('Response language', { exact: true }).selectOption('Chinese');
  await popup.getByLabel('Action name', { exact: true }).fill('Remote name');
  await settingsSection(popup, 'Presets');
  await popup.getByLabel('Model name', { exact: true }).fill('remote-model');
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(popup.getByText('Saved', { exact: true })).toBeVisible();
  await other.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(other.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await other.evaluate(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime) as (
      message: unknown,
    ) => Promise<unknown>;
    let failRead = true;
    chrome.runtime.sendMessage = (async (value: {
      target?: string;
      message?: { action?: string };
    }) => {
      if (failRead && value.target === 'saul-settings' && value.message?.action === 'read') {
        failRead = false;
        throw new Error('Synthetic read failure');
      }
      return original(value);
    }) as typeof chrome.runtime.sendMessage;
  });
  const review = other.getByRole('button', { name: 'Review latest', exact: true });
  await review.click();
  await expect(other.getByRole('alert')).toContainText('Your draft is still here');
  await expect(other.getByLabel('Action name', { exact: true })).toHaveValue('My reading');
  await review.click();
  const heading = other.getByRole('heading', { name: 'Review latest settings', exact: true });
  await expect(heading).toBeFocused();
  await other.getByRole('button', { name: 'Cancel review', exact: true }).click();
  await expect(review).toBeFocused();
  await expect(other.getByLabel('Action name', { exact: true })).toHaveValue('My reading');
  await expect(other.getByLabel('Response language', { exact: true })).toHaveValue('Chinese');
  await review.click();
  const name = other.getByRole('group', { name: 'Action “My reading” · Name', exact: true });
  await expect(name.getByRole('radio', { name: 'Mine', exact: true })).not.toBeChecked();
  await expect(name.getByRole('radio', { name: 'Latest', exact: true })).not.toBeChecked();
  await other.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  await expect(heading).toBeVisible();
  await name.getByRole('radio', { name: 'Mine', exact: true }).check();
  await expect(
    other
      .getByRole('group', { name: 'Response language', exact: true })
      .getByRole('radio', { name: 'Mine', exact: true }),
  ).toBeChecked();
  for (const width of [390, 1000]) {
    await other.setViewportSize({ width, height: 800 });
    await other.emulateMedia({ colorScheme: width === 390 ? 'dark' : 'light' });
    expect(await other.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (reviewScreenshots)
      await other.screenshot({
        path: info.outputPath(`review-edits-${width}.png`),
        fullPage: true,
      });
  }
  await other.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  await expect(other.getByRole('button', { name: 'Save', exact: true })).toBeFocused();
  await expect(other.getByLabel('Action name', { exact: true })).toHaveValue('My reading');
  const readSaved = () =>
    other.evaluate(
      async () => (await chrome.storage.local.get('saul_user_settings')).saul_user_settings,
    );
  expect(await readSaved()).toHaveProperty('configuration.recipes.0.name', 'Remote name');
  await other.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(other.getByText('Saved', { exact: true })).toBeVisible();
  const saved = await readSaved();
  expect(saved).toHaveProperty('configuration.recipes.0.name', 'My reading');
  expect(saved).toHaveProperty('configuration.presets.0.model', 'remote-model');
  expect(saved).toHaveProperty('responseLanguage', 'Chinese');
  await expect(
    other.getByText('Reviewed edits are in your draft. Save to apply them.'),
  ).toHaveCount(0);
});

test('an appearance change in another surface does not conflict with a settings draft', async ({
  sandbox,
}) => {
  const { popup, context } = await sandbox.launch();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(popup, 'Actions');
  await popup.getByLabel('Edit actions', { exact: true }).click();
  await popup.getByLabel('Action name', { exact: true }).fill('Personal recipe');
  const other = await context.newPage();
  await other.goto(popup.url().replace('popup.html', 'library.html'));
  await settingsSection(other, 'Preferences');
  await other.getByRole('checkbox', { name: 'Min Mode', exact: true }).uncheck();
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(popup.getByText('Saved', { exact: true })).toBeVisible();
  await expect(popup.getByRole('alert')).toHaveCount(0);
  expect(
    (await popup.evaluate(() => chrome.storage.local.get('saul_minimum_mode'))).saul_minimum_mode,
  ).toBe(false);
});
