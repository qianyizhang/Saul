import { test, expect } from './fixtures.ts';
import { configureFixtureProvider, createFixtureServer, taggedAnswer } from './support.ts';
import { explainSelection, getFirstHistory, openFirstPageExplanation } from './driver.ts';

test('Minimum Mode defaults on, updates open surfaces, and persists independently of provider drafts', async ({
  sandbox,
  fixtureServer,
}) => {
  let { popup, context } = await sandbox.launch();
  await expect(popup.locator('main')).toHaveAttribute('data-minimum', 'true');
  await expect(popup.getByRole('heading', { name: 'History', exact: true })).toBeHidden();
  await configureFixtureProvider(popup, fixtureServer.origin);
  const article = await context.newPage();
  await article.goto(fixtureServer.origin + '/article');
  await explainSelection(article);
  await article.getByRole('button', { name: 'View', exact: true }).click();
  const card = article.getByRole('region', { name: 'Saul explanation' });
  await expect(card.getByRole('status')).toHaveText('Saved');
  await expect(card.getByRole('button', { name: 'Copy explanation' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Bookmark', exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Simpler', exact: true })).toHaveCount(0);
  await card.getByRole('button', { name: 'More', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Simpler', exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Past attempts', exact: true })).toBeVisible();
  const details = card.locator('summary').filter({ hasText: /^Details$/ });
  await details.click();
  await details.press('Escape');
  await expect(details.locator('..')).not.toHaveAttribute('open');
  await expect(details).toBeFocused();
  await expect(card.getByRole('button', { name: 'More', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await details.press('Escape');
  await expect(card.getByRole('button', { name: 'More', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(card.getByRole('button', { name: 'More', exact: true })).toBeFocused();
  await expect(card).toBeVisible();

  const library = await context.newPage();
  await library.goto(popup.url().replace('popup.html', 'library.html') + '#history');
  await expect(library.locator('.history-entry')).toHaveCount(1);
  await expect(library.locator('.source-link')).toBeVisible();
  await expect(library.getByRole('button', { name: 'Delete highlight' })).toHaveCount(0);
  await library.locator('.history-title').click();
  await expect(library.getByRole('button', { name: 'Delete highlight' })).toBeHidden();
  await library.locator('.history-more > summary').click();
  await expect(library.getByRole('button', { name: 'Delete highlight' })).toBeVisible();

  await popup.keyboard.press('ControlOrMeta+,');
  const toggle = popup.getByRole('checkbox', { name: 'Minimum Mode', exact: false });
  await expect(toggle).toBeChecked();
  await popup.getByLabel('Base URL', { exact: true }).fill('invalid endpoint');
  await toggle.uncheck();
  await expect(popup.locator('main')).toHaveAttribute('data-minimum', 'false');
  await expect(library.locator('main')).toHaveAttribute('data-minimum', 'false');
  await expect(card).toHaveAttribute('data-minimum', 'false');
  await expect(card.getByRole('button', { name: 'Simpler', exact: true })).toBeVisible();
  await expect(popup.getByText('Unsaved changes', { exact: true })).toBeVisible();
  const stored = await popup.evaluate(() =>
    chrome.storage.local.get(['saul_minimum_mode', 'saul_user_settings']),
  );
  expect(stored.saul_minimum_mode).toBe(false);
  expect(stored.saul_user_settings).toMatchObject({
    openaiCompatible: { baseUrl: fixtureServer.origin + '/v1' },
  });

  ({ popup, context } = await sandbox.launch());
  await expect(popup.locator('main')).toHaveAttribute('data-minimum', 'false');
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(
    popup.getByRole('checkbox', { name: 'Minimum Mode', exact: false }),
  ).not.toBeChecked();
  const restoredArticle = await context.newPage();
  await restoredArticle.goto(fixtureServer.origin + '/article');
  await openFirstPageExplanation(restoredArticle);
  await expect(restoredArticle.getByRole('button', { name: 'Simpler', exact: true })).toBeVisible();
  await popup.getByRole('checkbox', { name: 'Minimum Mode', exact: false }).check();
  await expect(restoredArticle.getByRole('button', { name: 'Simpler', exact: true })).toHaveCount(
    0,
  );
});

test('appearance failure is visible and an unreadable provider record does not block its recovery control', async ({
  sandbox,
}) => {
  const { popup } = await sandbox.launch();
  await popup.evaluate(() =>
    chrome.storage.local.set({ saul_user_settings: { activeProvider: 'unknown' } }),
  );
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(popup.getByRole('alert')).toContainText('Saved provider is not supported');
  const toggle = popup.getByRole('checkbox', { name: 'Minimum Mode', exact: false });
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  await popup.evaluate(() => {
    const original = chrome.storage.local.set.bind(chrome.storage.local);
    chrome.storage.local.set = ((items: Record<string, unknown>) => {
      if ('saul_minimum_mode' in items) return Promise.reject(new Error('Fixture storage failure'));
      return original(items);
    }) as typeof chrome.storage.local.set;
  });
  // A failed write rolls back immediately, so click without Playwright's post-check state assertion.
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(
    popup.getByRole('alert').filter({ hasText: 'Could not save appearance' }),
  ).toBeVisible();
  expect(
    (await popup.evaluate(() => chrome.storage.local.get('saul_minimum_mode'))).saul_minimum_mode,
  ).toBe(false);
});

test('Escape closes a concept note, then the reading card', async ({ sandbox }) => {
  const server = await createFixtureServer(taggedAnswer);
  try {
    const { popup, context } = await sandbox.launch();
    await configureFixtureProvider(popup, server.origin);
    const article = await context.newPage();
    await article.goto(server.origin + '/article');
    await explainSelection(article);
    await article.getByRole('button', { name: 'View', exact: true }).click();
    const card = article.getByRole('region', { name: 'Saul explanation' });
    const concept = card.getByRole('button', { name: 'gradient', exact: true });
    await concept.focus();
    await expect(article.getByRole('tooltip')).toBeVisible();
    await concept.press('Escape');
    await expect(article.getByRole('tooltip')).toHaveCount(0);
    await expect(card).toBeVisible();
    await concept.press('Escape');
    await expect(card).toHaveCount(0);
  } finally {
    await server.close();
  }
});

test('a failed appearance save preserves a newer preference from another surface', async ({
  sandbox,
}) => {
  const { popup, context } = await sandbox.launch();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  const other = await context.newPage();
  await other.goto(popup.url().replace('popup.html', 'library.html'));
  await popup.evaluate(() => {
    const original = chrome.storage.local.set.bind(chrome.storage.local);
    const fixture = window as typeof window & {
      rejectAppearance?: () => void;
      appearanceChanged?: boolean;
    };
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && 'saul_minimum_mode' in changes) fixture.appearanceChanged = true;
    });
    chrome.storage.local.set = ((items: Record<string, unknown>) => {
      if (!('saul_minimum_mode' in items)) return original(items);
      return new Promise<void>((_resolve, reject) => {
        fixture.rejectAppearance = () => reject(new Error('Fixture storage failure'));
      });
    }) as typeof chrome.storage.local.set;
  });
  const toggle = popup.getByRole('checkbox', { name: 'Minimum Mode', exact: false });
  await toggle.uncheck();
  await expect(toggle).toBeDisabled();
  await other.evaluate(() => chrome.storage.local.set({ saul_minimum_mode: false }));
  await expect(other.locator('main')).toHaveAttribute('data-minimum', 'false');
  await expect
    .poll(() =>
      popup.evaluate(
        () => (window as typeof window & { appearanceChanged?: boolean }).appearanceChanged,
      ),
    )
    .toBe(true);
  await popup.evaluate(() => {
    (window as typeof window & { rejectAppearance?: () => void }).rejectAppearance?.();
  });
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  await expect(popup.getByRole('alert')).toContainText('Could not save appearance');
  expect(
    (await popup.evaluate(() => chrome.storage.local.get('saul_minimum_mode'))).saul_minimum_mode,
  ).toBe(false);
});

test('shared shortcuts explain only source selection, dismiss without cancelling, and stop only an open job', async ({
  sandbox,
}) => {
  const server = await createFixtureServer('A retained partial answer for keyboard controls.', {
    gated: true,
  });
  try {
    const { popup, context } = await sandbox.launch();
    await configureFixtureProvider(popup, server.origin);
    const article = await context.newPage();
    await article.goto(server.origin + '/article');
    await expect(article.locator('saul-root')).toBeAttached();
    await article.locator('#concept').click({ clickCount: 3 });
    const repeatedSubmit = await article.evaluate(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        metaKey: true,
        repeat: true,
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(repeatedSubmit).toBe(false);
    expect(server.requests).toHaveLength(0);
    await article.keyboard.press('ControlOrMeta+Enter');
    await expect.poll(() => server.requests.length).toBe(1);
    await article.getByRole('button', { name: 'View', exact: true }).click();
    await expect(article.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await article.keyboard.press('Escape');
    await expect(article.getByRole('region', { name: 'Saul explanation' })).toHaveCount(0);
    await article.keyboard.press('ControlOrMeta+.');
    expect((await getFirstHistory(popup)).latest.status).toBe('running');
    await openFirstPageExplanation(article);
    await article.keyboard.press('ControlOrMeta+.');
    await expect(article.getByRole('status').filter({ hasText: /^Stopped$/ })).toBeVisible();
    expect((await getFirstHistory(popup)).latest.status).toBe('cancelled');
    await expect(
      article.getByRole('button', { name: 'Retry explanation', exact: true }),
    ).toBeVisible();

    await article.keyboard.press('Escape');
    await article.locator('#second').click({ clickCount: 3 });
    const consumed = await article.evaluate(() => {
      const input = document.createElement('input');
      document.body.append(input);
      input.focus();
      return ['Enter', '.', 'n', 't', 'l', 'w', 'f'].map((key) => {
        const event = new KeyboardEvent('keydown', {
          key,
          metaKey: true,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        });
        input.dispatchEvent(event);
        return event.defaultPrevented;
      });
    });
    expect(consumed).toEqual([false, false, false, false, false, false, false]);
    expect(server.requests).toHaveLength(1);
    const browserKeys = await article.evaluate(() =>
      ['n', 't', 'l', 'w', 'f'].map((key) => {
        const event = new KeyboardEvent('keydown', {
          key,
          metaKey: true,
          bubbles: true,
          cancelable: true,
        });
        document.body.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    );
    expect(browserKeys).toEqual([false, false, false, false, false]);
  } finally {
    await server.close();
  }
});

test('Minimum Mode stays usable at narrow touch widths with visible errors and essential actions', async ({
  sandbox,
}, info) => {
  const server = await createFixtureServer('A partially delivered explanation.', { ending: 'eof' });
  try {
    const { popup, context } = await sandbox.launch();
    await configureFixtureProvider(popup, server.origin);
    const article = await context.newPage();
    await article.goto(server.origin + '/article');
    await explainSelection(article);
    await expect.poll(async () => (await getFirstHistory(popup)).latest.status).toBe('interrupted');
    await openFirstPageExplanation(article);
    const card = article.getByRole('region', { name: 'Saul explanation' });
    await expect(card.getByRole('alert')).toBeVisible();
    await expect(card.getByRole('status')).toHaveText('Interrupted');
    await popup.getByRole('button', { name: 'History', exact: true }).click();
    await popup.locator('.history-title').click();
    for (const page of [popup, article]) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    }
    for (const width of [360, 440, 1000]) {
      for (const colorScheme of ['light', 'dark'] as const) {
        for (const [name, page] of [
          ['history', popup],
          ['overlay', article],
        ] as const) {
          await page.setViewportSize({ width, height: 640 });
          await page.emulateMedia({ colorScheme });
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          await page.screenshot({
            path: info.outputPath(`${name}-${width}-${colorScheme}.png`),
            fullPage: name === 'history',
          });
        }
        const box = (await card.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.y + box.height).toBeLessThanOrEqual(640);
        for (const button of [
          card.getByRole('button', { name: 'Copy explanation' }),
          card.getByRole('button', { name: 'Retry explanation' }),
          card.getByRole('button', { name: 'Bookmark', exact: true }),
          card.getByRole('button', { name: 'More', exact: true }),
          popup.getByRole('button', { name: 'Bookmarks', exact: true }),
        ]) {
          const target = (await button.boundingBox())!;
          expect(target.height).toBeGreaterThanOrEqual(44);
          expect(target.width).toBeGreaterThanOrEqual(44);
        }
      }
    }
  } finally {
    await server.close();
  }
});
