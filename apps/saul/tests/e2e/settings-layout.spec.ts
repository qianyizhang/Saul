import { settingsSection } from './driver.ts';
import { reviewScreenshots } from './artifacts.ts';
import { test, expect } from './fixtures.ts';
import { configureFixtureProvider } from './support.ts';

test('Min Mode omits secondary settings copy and keeps permission effects visible', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { popup } = await sandbox.launch();
  await configureFixtureProvider(popup, fixtureServer.origin);
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(popup.getByText('Configuration', { exact: true })).toBeHidden();
  await settingsSection(popup, 'Preferences');
  const toggle = popup.getByRole('checkbox', { name: 'Min Mode', exact: true });
  await expect(toggle).toBeChecked();
  const integrations = popup.locator('summary').filter({ hasText: /^Integrations$/ });
  await integrations.focus();
  await integrations.press('Enter');
  const sharedCredentialDescription = popup.getByText('The signed Saul helper keeps credentials');
  const pagePermission = popup.getByText('Clicks may submit forms or change website data.');
  const tabPermission = popup.getByText('Local tools can read tab titles and URLs');
  const tabTip = popup.getByText('You can use the Window tab without enabling Codex access.');
  for (const minimum of [true, false, true]) {
    await toggle.setChecked(minimum);
    await expect(pagePermission).toBeVisible();
    await expect(tabPermission).toBeVisible();
    if (minimum) {
      await expect(sharedCredentialDescription).toBeHidden();
      await expect(tabTip).toBeHidden();
    } else {
      await expect(sharedCredentialDescription).toBeVisible();
      await expect(tabTip).toBeVisible();
    }
  }
  if (reviewScreenshots) {
    await expect(toggle).toBeEnabled();
    await popup.screenshot({ path: info.outputPath('integrations-min.png') });
    await toggle.uncheck();
    await expect(sharedCredentialDescription).toBeVisible();
    await expect(toggle).toBeEnabled();
    await popup.screenshot({ path: info.outputPath('integrations-standard.png') });
  }
});

test('focused settings preserves drafts across sections and keeps Min Mode concise', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { popup: toolbar, context } = await sandbox.launch();
  const popup = await context.newPage();
  await popup.goto(toolbar.url().replace('popup.html', 'library.html'));
  await configureFixtureProvider(popup, fixtureServer.origin);
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(popup.getByRole('main')).toHaveCount(1);
  await expect(popup.getByLabel('Default action', { exact: true })).toBeVisible();
  await expect(popup.getByLabel('Response language', { exact: true })).toBeVisible();
  const identity = await popup.evaluate(async () => {
    const response = await fetch(chrome.runtime.getURL('/build-info.json'));
    const info = (await response.json()) as { build: string };
    return { version: chrome.runtime.getManifest().version, build: info.build.slice(0, 12) };
  });
  await expect(popup.getByLabel('Saul version', { exact: true })).toHaveText(
    `Version ${identity.version} · Build ${identity.build}`,
  );
  await expect(popup.getByLabel('Model name', { exact: true })).toBeHidden();
  await popup
    .getByRole('region', { name: 'Overview' })
    .getByRole('button', { name: /^Presets/ })
    .click();
  await popup.getByLabel('Model name', { exact: true }).fill('');
  await popup.getByLabel('Model name', { exact: true }).pressSequentially('draft-model');
  await expect(popup.getByLabel('Model name', { exact: true })).toBeFocused();
  await expect(popup.getByRole('button', { name: 'Add preset', exact: true })).toHaveText('+');
  await settingsSection(popup, 'Actions');
  const edit = popup.getByLabel('Edit actions', { exact: true });
  expect(await edit.innerText()).toBe('Actions');
  await edit.focus();
  await popup.keyboard.press('Enter');
  await expect(popup.getByLabel('Template syntax', { exact: true })).toBeHidden();
  await popup.getByLabel('Action name', { exact: true }).fill('Careful reading');
  await settingsSection(popup, 'Presets');
  await expect(popup.getByLabel('Model name', { exact: true })).toHaveValue('draft-model');
  await expect(popup.getByLabel('Action name', { exact: true })).toBeHidden();
  await settingsSection(popup, 'Actions');
  await expect(popup.getByLabel('Action name', { exact: true })).toHaveValue('Careful reading');
  await popup.getByLabel('Include with selected text', { exact: true }).click();
  await popup.getByLabel('Section heading', { exact: true }).uncheck();
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(popup.getByText('Saved', { exact: true })).toBeVisible();
  await popup.reload();
  await settingsSection(popup, 'Presets');
  await expect(popup.getByLabel('Model name', { exact: true })).toHaveValue('draft-model');
  await settingsSection(popup, 'Actions');
  await edit.click();
  await expect(popup.getByLabel('Action name', { exact: true })).toHaveValue('Careful reading');
  await popup.getByLabel('Include with selected text', { exact: true }).click();
  await expect(popup.getByLabel('Section heading', { exact: true })).not.toBeChecked();
  for (const section of [
    'Overview',
    'Presets',
    'Actions',
    'Calls',
    'Preferences',
    'Connections',
  ] as const) {
    await settingsSection(popup, section);
    for (const width of [390, 640, 1100]) {
      await popup.setViewportSize({ width, height: 720 });
      for (const colorScheme of ['light', 'dark'] as const) {
        await popup.emulateMedia({ colorScheme });
        expect(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        if (reviewScreenshots) {
          await popup.bringToFront();
          await popup.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              ),
          );
          await popup.screenshot({
            path: info.outputPath(`settings-${section}-${width}-${colorScheme}.png`),
            animations: 'disabled',
          });
        }
      }
    }
  }
});

test('long saved passages remain scannable until opened', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { popup, context } = await sandbox.launch();
  await configureFixtureProvider(popup, fixtureServer.origin);
  const article = await context.newPage();
  await article.goto(fixtureServer.origin + '/article');
  const passage = 'Readable previews keep a long saved passage easy to scan. '.repeat(14);
  await article.locator('#concept').evaluate((element, text) => {
    element.textContent = text;
  }, passage);
  await article.locator('#concept').click({ clickCount: 3 });
  await article.getByRole('button', { name: 'Explain & open', exact: true }).click();
  await expect(
    article.getByRole('region', { name: 'Saul explanation' }).getByRole('status'),
  ).toHaveText('Saved');
  await popup.getByRole('button', { name: 'History', exact: true }).click();
  await expect(popup.locator('.history-preview')).toHaveText(passage);
  for (const width of [360, 640]) {
    await popup.setViewportSize({ width, height: 600 });
    const preview = popup.locator('.history-preview');
    expect(
      await preview.evaluate(
        (el) =>
          el.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(el).lineHeight),
      ),
    ).toBeLessThanOrEqual(3.1);
    expect((await popup.getByLabel('Search history').boundingBox())!.width).toBeGreaterThan(200);
    if (reviewScreenshots)
      await popup.screenshot({ path: info.outputPath(`history-${width}.png`) });
    await popup.locator('.history-title').click();
    expect(
      await preview.evaluate(
        (el) =>
          el.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(el).lineHeight),
      ),
    ).toBeGreaterThan(3.1);
    await expect(popup.locator('.answer')).toBeVisible();
    await popup.locator('.history-title').click();
  }
});

test('toolbar popup opens at a usable default width', async ({ sandbox }, info) => {
  const { worker, popup } = await sandbox.launch();
  await popup.bringToFront();
  await worker.evaluate(() => chrome.action.openPopup());
  // Browser-action popups are extension views, not tab targets in Playwright.
  await expect
    .poll(() =>
      popup.evaluate(() => {
        const view = chrome.extension.getViews({ type: 'popup' })[0];
        return view?.innerWidth;
      }),
    )
    .toBe(640);
  const bounds = await popup.evaluate(() => {
    const view = chrome.extension.getViews({ type: 'popup' })[0]!;
    return {
      width: view.innerWidth,
      height: view.innerHeight,
      contentWidth: view.document.documentElement.scrollWidth,
    };
  });
  expect(bounds.contentWidth).toBeLessThanOrEqual(bounds.width);
  await info.attach('toolbar-bounds', {
    body: JSON.stringify(bounds),
    contentType: 'application/json',
  });
});
