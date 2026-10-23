import { test, expect } from './fixtures.ts';
import { configureFixtureProvider } from './support.ts';

test('settings keeps essentials visible and preserves drafts through disclosures', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { popup } = await sandbox.launch();
  await configureFixtureProvider(popup, fixtureServer.origin);
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  for (const label of ['AI service', 'Model name', 'Default recipe', 'Response language']) {
    await expect(popup.getByLabel(label, { exact: true })).toBeVisible();
  }
  for (const label of ['Preset name', 'Recipe name', 'API key', 'Section heading']) {
    await expect(popup.getByLabel(label, { exact: true })).toBeHidden();
  }
  await expect(popup.getByText('Changes here save immediately.', { exact: true })).toBeVisible();
  const edit = popup.getByText('Edit recipes', { exact: true });
  await edit.focus();
  await popup.keyboard.press('Enter');
  await popup.getByLabel('Recipe name', { exact: true }).fill('Careful reading');
  await edit.click();
  await popup.getByText('Include with selected text', { exact: true }).click();
  await expect(
    popup.getByText('Checked page information is sent to your model with the selection.'),
  ).toBeVisible();
  await popup.getByLabel('Section heading', { exact: true }).uncheck();
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(popup.getByText('Saved', { exact: true })).toBeVisible();
  await popup.reload();
  await edit.click();
  await expect(popup.getByLabel('Recipe name', { exact: true })).toHaveValue('Careful reading');
  await edit.click();
  await popup.getByText('Include with selected text', { exact: true }).click();
  await expect(popup.getByLabel('Section heading', { exact: true })).not.toBeChecked();
  await popup.getByText('Include with selected text', { exact: true }).click();
  for (const width of [360, 640, 1000]) {
    await popup.setViewportSize({ width, height: 720 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await popup.emulateMedia({ colorScheme });
      await popup.getByRole('button', { name: 'Settings', exact: true }).scrollIntoViewIfNeeded();
      expect(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await popup.screenshot({
        path: info.outputPath(`settings-${width}-${colorScheme}.png`),
        fullPage: true,
      });
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
  await article.getByRole('button', { name: 'Explain', exact: true }).click();
  await article.getByRole('button', { name: 'View', exact: true }).click();
  await expect(article.getByRole('button', { name: 'Regenerate', exact: true })).toBeVisible();
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
