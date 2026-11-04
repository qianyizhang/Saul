import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.ts';
import { settingsSection } from './driver.ts';
import { reviewScreenshots } from './artifacts.ts';
import type { PlanControlRequest } from '../../native/plan-protocol.mts';
import type { SharedPresets } from '../../native/shared-presets-contract.mts';

// Replace only the OS message transport. Production Settings, its write owner,
// scoped projection and typed library validation stay in the actual extension.
test('shared provider edits keep stable preset bindings and preserve Draw through unrelated saves', async ({
  sandbox,
}, info) => {
  const { popup, worker, context } = await sandbox.launch();
  const providers = JSON.parse(
    readFileSync(new URL('../../../../contracts/fixtures/providers.json', import.meta.url), 'utf8'),
  ).providers;
  await worker.evaluate((providers) => {
    const state = {
      library: {
        revision: 0,
        providers,
        presets: [
          {
            id: 'c14b29f3-3ec2-4efc-8bed-e05531aef2cb',
            name: 'Illustration',
            model: 'gpt-image-2.5-flare',
            effort: '',
            fast: false,
            providerKey: 'openai-api',
            capability: 'draw' as const,
            imageOptions: { size: '1536x1024', quality: 'medium' },
          },
        ],
      } as SharedPresets,
      sections: {} as Record<string, { revision: number; value?: Record<string, unknown> }>,
    };
    Object.assign(globalThis, { sharedSettingsFixture: state });
    chrome.runtime.sendNativeMessage = (async (
      _host: string,
      message: { id: string; request: PlanControlRequest },
    ) => {
      const request = message.request;
      if (request.action === 'config-read')
        return {
          id: message.id,
          event: { type: 'result', config: state.sections[request.section] || { revision: 0 } },
        };
      if (request.action === 'config-save') {
        if ((state.sections[request.section]?.revision || 0) !== request.revision)
          throw new Error('Scoped settings changed.');
        state.sections[request.section] = { revision: request.revision + 1, value: request.value };
        return {
          id: message.id,
          event: { type: 'result', config: state.sections[request.section] },
        };
      }
      if (request.action === 'presets-save') {
        if (state.library.revision !== request.revision) throw new Error('Shared presets changed.');
        state.library = {
          revision: request.revision + 1,
          presets: request.presets,
          providers: request.providers || state.library.providers,
        };
      }
      if (request.action === 'presets-read' || request.action === 'presets-save')
        return { id: message.id, event: { type: 'result', library: state.library } };
      throw new Error('Unexpected provider operation');
    }) as typeof chrome.runtime.sendNativeMessage;
  }, providers);
  const page = await context.newPage();
  await page.goto(popup.url().replace('popup.html', 'library.html'));
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(page, 'Presets');
  await page.getByRole('button', { name: 'Illustration', exact: true }).click();
  await expect(
    page.getByText('Draw preset · edit image settings in EZ. Saul currently runs Write actions.'),
  ).toBeVisible();
  await expect(page.getByLabel('Model name', { exact: true })).toBeHidden();
  await settingsSection(page, 'Actions');
  await page.getByLabel('Response language', { exact: true }).selectOption('Chinese');
  await settingsSection(page, 'Providers');
  await page.getByRole('button', { name: 'My API', exact: true }).click();
  await expect(page.getByLabel('Provider name', { exact: true })).toHaveValue('My API');
  await page.getByLabel('Provider name', { exact: true }).fill('Renamed in Saul');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  const saved = await worker.evaluate(
    () =>
      (
        globalThis as unknown as {
          sharedSettingsFixture: {
            library: SharedPresets;
            sections: Record<string, { value?: Record<string, unknown> }>;
          };
        }
      ).sharedSettingsFixture,
  );
  expect(saved.library.providers?.[1]).toEqual({
    key: 'openai-api',
    name: 'Renamed in Saul',
    kind: 'openai-api',
  });
  expect(saved.library.presets[0]).toMatchObject({
    providerKey: 'openai-api',
    capability: 'draw',
    imageOptions: { size: '1536x1024', quality: 'medium' },
  });
  expect(saved.sections.settings?.value).not.toHaveProperty('providers');
  for (const width of [390, 1100])
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ colorScheme });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (reviewScreenshots)
        await page.screenshot({
          path: info.outputPath(`providers-${width}-${colorScheme}.png`),
          animations: 'disabled',
        });
    }
  await worker.evaluate(() => {
    const state = (globalThis as unknown as { sharedSettingsFixture: { library: SharedPresets } })
      .sharedSettingsFixture;
    state.library.providers![1]!.name = 'Renamed in EZ';
    state.library.revision++;
  });
  await page.reload();
  await settingsSection(page, 'Providers');
  await page.getByRole('button', { name: 'Renamed in EZ', exact: true }).click();
  await expect(page.getByLabel('Provider name', { exact: true })).toHaveValue('Renamed in EZ');
});
