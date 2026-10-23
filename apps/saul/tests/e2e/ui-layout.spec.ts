import { test, expect } from './fixtures.ts';
import { configureFixtureProvider, createFixtureServer, taggedAnswer } from './support.ts';

test('compact workspace supports reading, tab controls and reachable settings', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { popup, context } = await sandbox.launch();
  await popup.emulateMedia({ colorScheme: 'light' });
  await popup.setViewportSize({ width: 440, height: 600 });
  await expect(popup.getByRole('button', { name: 'History', exact: true })).toBeVisible();
  await expect(popup.getByText('No highlights recorded yet.')).toBeVisible();
  await popup.screenshot({ path: info.outputPath('01-reading.png'), fullPage: true });
  await configureFixtureProvider(popup, fixtureServer.origin);
  const article = await context.newPage();
  await article.goto(fixtureServer.origin + '/article');
  await article.emulateMedia({ colorScheme: 'light' });
  await expect(article.locator('saul-root')).toBeAttached();
  await article.locator('#concept').click({ clickCount: 3 });
  await article.getByRole('button', { name: 'Explain', exact: true }).click();
  await article.getByRole('button', { name: 'View', exact: true }).click();
  await expect(article.getByRole('button', { name: 'Regenerate', exact: true })).toBeVisible();
  await article.screenshot({ path: info.outputPath('02-explanation.png') });
  await popup.getByRole('button', { name: 'History', exact: true }).click();
  await expect(popup.locator('.history-title')).toHaveCount(1);
  await popup.locator('.history-title').click();
  await popup.screenshot({ path: info.outputPath('03-history.png'), fullPage: true });
  await popup.getByRole('button', { name: 'Window', exact: true }).click();
  await expect(popup.locator('.tab-row').first()).toBeVisible();
  await expect(popup.getByLabel('Codex tab access')).toBeHidden();
  await expect(popup.getByRole('button', { name: 'Group', exact: true })).toHaveCount(0);
  await popup.screenshot({ path: info.outputPath('04-tabs.png'), fullPage: true });
  await popup
    .getByRole('checkbox', { name: 'Select Calculus reading fixture', exact: true })
    .check();
  await expect(popup.getByRole('button', { name: 'Group', exact: true })).toBeEnabled();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  const connection = popup.locator('summary').filter({ hasText: /^Codex connection$/ });
  await connection.focus();
  await popup.keyboard.press('Enter');
  await expect(popup.getByLabel('Codex tab access')).toBeVisible();
  await popup.getByText('Connect Codex · setup and troubleshooting', { exact: true }).click();
  await expect(
    popup
      .locator('code')
      .filter({ hasText: 'node scripts/setup.mts --components tabs --extension-id' }),
  ).toBeVisible();
  await popup.getByText('Connect Codex · setup and troubleshooting', { exact: true }).click();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(popup.getByLabel('AI service', { exact: true })).toBeVisible();
  const save = popup.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeInViewport();
  await popup.screenshot({ path: info.outputPath('05-settings.png') });
  await popup.getByLabel('Model name', { exact: true }).fill('');
  await save.click();
  await expect(popup.getByRole('alert')).toBeInViewport();
  await popup.getByLabel('Model name', { exact: true }).fill('changed-model');
  popup.once('dialog', (dialog) => dialog.dismiss());
  await popup.getByRole('button', { name: 'Window', exact: true }).click();
  await expect(popup.getByLabel('Model name', { exact: true })).toHaveValue('changed-model');
  await save.click();
  await expect(popup.getByText('Saved', { exact: true })).toBeVisible();
  await popup.reload();
  await expect(popup.getByLabel('Model name', { exact: true })).toHaveValue('changed-model');
  for (const width of [360, 440, 1000]) {
    await popup.setViewportSize({ width, height: 600 });
    await popup.getByRole('button', { name: 'History', exact: true }).click();
    await expect(popup.locator('.history-title')).toHaveCount(1);
    expect(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await popup.goto(popup.url().replace('popup.html', 'library.html'));
  await expect(popup.locator('.history-title')).toHaveCount(1);
  await popup.screenshot({ path: info.outputPath('06-full-workspace.png') });
  for (const colorScheme of ['light', 'dark'] as const) {
    await popup.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await article.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await popup.screenshot({
      path: info.outputPath(`07-library-${colorScheme}.png`),
      fullPage: true,
    });
    await article.screenshot({ path: info.outputPath(`08-overlay-${colorScheme}.png`) });
    // Readability uses actual painted colors in both isolated extension contexts.
    for (const [page, content, surface] of [
      [popup, '.history-title', '.history-entry'],
      [article, '.saul-reading', '[aria-label="Saul explanation"]'],
    ] as const) {
      const ratio = await page
        .locator(content)
        .first()
        .evaluate((el, surfaceSelector) => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const ctx = canvas.getContext('2d')!;
          const luminance = (color: string) => {
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 1, 1);
            const pixel = ctx.getImageData(0, 0, 1, 1).data;
            const linear = [...pixel].slice(0, 3).map((v) => {
              const x = v / 255;
              return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
            });
            return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
          };
          const foreground = luminance(getComputedStyle(el).color);
          const background = luminance(
            getComputedStyle(el.closest(surfaceSelector)!).backgroundColor,
          );
          return (
            (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
          );
        }, surface);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test('shared appearance supports concept notes, page lists, errors and reduced-motion streaming', async ({
  sandbox,
}, info) => {
  const server = await createFixtureServer(taggedAnswer, { gated: true });
  try {
    const { popup, context } = await sandbox.launch();
    await configureFixtureProvider(popup, server.origin);
    const article = await context.newPage();
    await article.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await article.goto(server.origin + '/article');
    await article.locator('#concept').click({ clickCount: 3 });
    await article.getByRole('button', { name: 'Explain', exact: true }).click();
    await article.getByRole('button', { name: 'View', exact: true }).click();
    await expect(article.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await expect(article.locator('.animate-pulse').first()).toBeAttached();
    expect(
      await article
        .locator('.animate-pulse')
        .first()
        .evaluate((el) => getComputedStyle(el).animationName),
    ).toBe('none');
    await article.screenshot({ path: info.outputPath('09-streaming-reduced-motion.png') });
    server.releaseAll();
    await expect(article.getByRole('button', { name: 'Regenerate', exact: true })).toBeVisible();
    const term = article.getByRole('button', { name: 'gradient', exact: true });
    await term.focus();
    await expect(article.getByRole('tooltip')).toBeVisible();
    expect(
      await article
        .getByRole('tooltip')
        .locator('p')
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toBe(
      await article
        .locator('.saul-reading')
        .first()
        .evaluate((el) => getComputedStyle(el).fontFamily),
    );
    for (const colorScheme of ['light', 'dark'] as const) {
      await article.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await article.screenshot({ path: info.outputPath(`10-concept-note-${colorScheme}.png`) });
    }
    await term.press('Escape');
    await expect(article.getByRole('tooltip')).toHaveCount(0);
    await article.getByRole('button', { name: 'Close explanation' }).click();
    await article.getByRole('button', { name: 'Page explanations', exact: true }).click();
    await expect(article.getByRole('region', { name: 'Page explanations' })).toBeVisible();
    await article.screenshot({ path: info.outputPath('11-page-list-dark.png') });
    await article.getByRole('button', { name: 'Page explanations', exact: true }).click();
    server.setEnding('eof');
    await article.locator('#second').click({ clickCount: 3 });
    await article.getByRole('button', { name: 'Explain', exact: true }).click();
    await expect.poll(() => server.pendingCount()).toBe(1);
    server.releaseAll();
    await article.getByRole('button', { name: 'Page explanations', exact: true }).click();
    await article
      .getByRole('region', { name: 'Page explanations' })
      .getByRole('button', { name: /^Follow the gradient/ })
      .click();
    await expect(
      article.getByRole('button', { name: 'Retry explanation', exact: true }),
    ).toBeVisible();
    await article.screenshot({ path: info.outputPath('13-incomplete-card-dark.png') });
    await article.getByRole('button', { name: 'Close explanation' }).click();
    // A missing remote key rejects at submission, before any network request.
    await configureFixtureProvider(popup, 'https://api.openai.com');
    await article.locator('#third').click({ clickCount: 3 });
    await article.getByRole('button', { name: 'Explain', exact: true }).click();
    await expect(article.getByRole('alert')).toContainText('API key is missing');
    await article.screenshot({ path: info.outputPath('12-error-notification-dark.png') });
  } finally {
    await server.close();
  }
});

test('answer metadata stays aligned and readable in cards and history at compact and wide widths', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const initialRequests = fixtureServer.requests.length;
  const { popup, context } = await sandbox.launch();
  await configureFixtureProvider(popup, fixtureServer.origin);
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  const longModel = 'test-model-with-a-deliberately-long-identifier-for-wrapping';
  await popup.getByLabel('Model name', { exact: true }).fill(longModel);
  await popup.getByText('Manage model presets', { exact: true }).click();
  await popup
    .getByLabel('Preset name', { exact: true })
    .fill('Careful reading with a deliberately long preset name');
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(popup.getByText('Saved', { exact: true })).toBeVisible();
  const article = await context.newPage();
  await article.goto(fixtureServer.origin + '/article');
  await article.locator('#concept').click({ clickCount: 3 });
  await article.getByRole('button', { name: 'Explain', exact: true }).click();
  await article.getByRole('button', { name: 'View', exact: true }).click();
  await expect(article.getByRole('button', { name: 'Regenerate', exact: true })).toBeVisible();
  await popup.getByRole('button', { name: 'History', exact: true }).click();
  await popup.locator('.history-title').click();
  for (const [name, page] of [
    ['card', article],
    ['history', popup],
  ] as const) {
    const details = page.locator('.saul-run-details').first();
    // Details is available without opening More; native summary supports keyboard activation.
    await details.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(details).toHaveAttribute('open');
    await expect(details.locator('dt')).toHaveText([
      'Created',
      'Recipe',
      'Preset',
      'Provider',
      'Model',
      'Total time',
    ]);
    await expect(details.locator('dd').filter({ hasText: longModel })).toHaveCount(1);
    for (const width of [360, 440, 1000]) {
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.setViewportSize({ width, height: 820 });
        await page.emulateMedia({ colorScheme });
        await details.scrollIntoViewIfNeeded();
        const layout = await details.locator('.saul-metadata').evaluate((list) => {
          const values = [...list.querySelectorAll('dd')];
          const labels = [...list.querySelectorAll('dt')];
          return {
            starts: values.map((el) => el.getBoundingClientRect().x),
            fits: values.every((el) => el.scrollWidth <= el.clientWidth),
            distinct: getComputedStyle(values[0]!).color !== getComputedStyle(labels[0]!).color,
          };
        });
        expect(Math.max(...layout.starts) - Math.min(...layout.starts)).toBeLessThan(1);
        expect(layout.fits).toBe(true);
        expect(layout.distinct).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: info.outputPath(`metadata-${name}-${width}-${colorScheme}.png`),
        });
      }
    }
  }
  expect(fixtureServer.requests).toHaveLength(initialRequests + 1);
});
