import { test, expect } from './fixtures.ts';
import { configureFixtureProvider } from './support.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
async function select(page: Page, selector: string) {
  await page.locator(selector).dblclick();
  await page.getByRole('button', { name: 'Explain', exact: true }).click();
  await expect(page.getByText('Explanation ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
}
const card = (page: Page) => page.getByRole('region', { name: 'Saul explanation' });
test('only the selected occurrence attaches; class reveal, layout movement, ambiguity, native links and source DOM remain safe', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { popup, context } = await sandbox.launch();
  await configureFixtureProvider(popup, fixtureServer.origin);
  const page = await context.newPage();
  await page.goto(fixtureServer.origin + '/anchors');
  await expect(page.locator('saul-root')).toBeAttached();
  const original = await page.locator('#article').innerHTML();
  await select(page, '#term-two');
  expect(await page.locator('#article').innerHTML()).toBe(original);
  await page.locator('#term-one').click();
  await expect(card(page)).toHaveCount(0);
  await page.locator('#term-two').click();
  await expect(card(page)).toBeVisible();
  await page.getByRole('button', { name: 'Close explanation' }).click();
  await page.reload();
  await page.locator('#two').evaluate((el) => el.classList.add('hidden'));
  await page.getByRole('button', { name: 'Page explanations', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Page explanations' })).toContainText(
    'location unavailable',
  );
  await page.locator('#two').evaluate((el) => el.classList.remove('hidden'));
  await expect(page.getByRole('region', { name: 'Page explanations' })).not.toContainText(
    'location unavailable',
  );
  await page.locator('#late').evaluate((el) => {
    (el as HTMLElement).style.height = '180px';
  });
  await expect(async () => {
    await page.locator('#term-two').click();
    await expect(card(page)).toBeVisible();
  }).toPass();
  await page.screenshot({ path: info.outputPath('restored-marker.png') });
  await page.getByRole('button', { name: 'Close explanation' }).click();
  await page.locator('#two').evaluate((el) => el.after(el.cloneNode(true)));
  await page.getByRole('button', { name: 'Page explanations', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Page explanations' })).toContainText(
    'location unavailable',
  );
  await page.locator('#term-two').first().click();
  await expect(card(page)).toHaveCount(0);
  await page.locator('#native').click();
  await expect(page).toHaveURL(/#native-link$/);
  await expect(card(page)).toHaveCount(0);
});
test('View source opens a new tab, restores below-fold location and opens the saved answer', async ({
  sandbox,
  fixtureServer,
}) => {
  const { context, popup } = await sandbox.launch();
  await configureFixtureProvider(popup, fixtureServer.origin);
  const page = await context.newPage();
  await page.goto(fixtureServer.origin + '/long');
  await expect(page.locator('saul-root')).toBeAttached();
  await page.locator('#concept').scrollIntoViewIfNeeded();
  await page.locator('#concept').click({ clickCount: 3 });
  await page.getByRole('button', { name: 'Explain', exact: true }).click();
  await expect(page.getByText('Explanation ready', { exact: true })).toBeVisible();
  await page.close();
  await popup.getByRole('button', { name: 'Reading history', exact: true }).click();
  const opening = context.waitForEvent('page');
  await popup.getByTitle('View source and explanation').click();
  const source = await opening;
  await expect(card(source)).toBeVisible();
  await expect.poll(() => source.evaluate(() => scrollY)).toBeGreaterThan(1500);
  await expect(source.locator('#concept')).toBeInViewport();
});
test('highlight API feasibility and native non-layout underlines in target Chrome', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { context, popup } = await sandbox.launch();
  await configureFixtureProvider(popup, fixtureServer.origin);
  const page = await context.newPage();
  await page.goto(fixtureServer.origin + '/article');
  await expect(page.locator('saul-root')).toBeAttached();
  const capability = await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('#concept')!);
    const api = CSS as unknown as {
      highlights?: Map<string, unknown> & { highlightsFromPoint?: unknown };
    };
    const Highlight = (globalThis as unknown as { Highlight?: new (range: Range) => unknown })
      .Highlight;
    if (!api.highlights || !Highlight) return { highlights: false };
    api.highlights.set('feasibility', new Highlight(range));
    const style = document.createElement('style');
    style.textContent =
      '::highlight(feasibility){text-decoration:underline;text-decoration-color:red;}';
    document.head.append(style);
    const decoration = getComputedStyle(
      document.querySelector('#concept')!,
      '::highlight(feasibility)',
    ).textDecorationLine;
    const hitTesting = typeof api.highlights.highlightsFromPoint === 'function';
    api.highlights.delete('feasibility');
    style.remove();
    return { highlights: true, decoration, hitTesting };
  });
  await mkdir('docs/benchmarks', { recursive: true });
  await writeFile(
    'docs/benchmarks/rendering-capabilities.json',
    JSON.stringify({ browser: context.browser()?.version(), ...capability }, null, 2) + '\n',
  );
  await info.attach('highlight-capability', {
    body: JSON.stringify({ browser: context.browser()?.version(), ...capability }),
    contentType: 'application/json',
  });
  const before = await page.locator('#concept').boundingBox();
  const html = await page.locator('#concept').innerHTML();
  await page.locator('#concept').click({ clickCount: 3 });
  await page.getByRole('button', { name: 'Explain', exact: true }).click();
  await expect(page.getByText('Explanation ready', { exact: true })).toBeVisible();
  expect(await page.locator('#concept').boundingBox()).toEqual(before);
  expect(await page.locator('#concept').innerHTML()).toEqual(html);
  await page.addStyleTag({
    content: 'html{color-scheme:dark;background:#181818;color:#eee}body{zoom:1.2}',
  });
  await page.locator('#concept').click({ position: { x: 30, y: 15 } });
  await expect(card(page)).toBeVisible();
  await page.screenshot({ path: info.outputPath('dark-zoom-marker.png') });
});

test('replaced text reattaches while unrelated content keeps mutating', async ({
  sandbox,
  fixtureServer,
}) => {
  const { popup, context } = await sandbox.launch();
  await configureFixtureProvider(popup, fixtureServer.origin);
  const page = await context.newPage();
  await page.goto(fixtureServer.origin + '/anchors');
  await select(page, '#term-two');
  await page.evaluate(() => {
    const clock = document.createElement('div');
    document.body.append(clock);
    setInterval(() => {
      clock.textContent = String(Date.now());
    }, 40);
    const term = document.querySelector('#term-two')!;
    term.replaceChildren(document.createTextNode('gradient'));
  });
  await expect
    .poll(
      async () => {
        await page.locator('#term-two').click();
        return card(page).isVisible();
      },
      { timeout: 3000 },
    )
    .toBe(true);
});

test('nested scrolling keeps clipped underlines from intercepting adjacent text', async ({
  sandbox,
  fixtureServer,
}) => {
  const { popup, context } = await sandbox.launch();
  await configureFixtureProvider(popup, fixtureServer.origin);
  const page = await context.newPage();
  await page.goto(fixtureServer.origin + '/anchors');
  await select(page, '#term-clipped');
  await page.locator('#term-clipped').click();
  await expect(card(page)).toBeVisible();
  await page.getByRole('button', { name: 'Close explanation' }).click();
  await page.locator('#scroller').evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.locator('#clipped').click({ position: { x: 25, y: 15 } });
  await expect(card(page)).toHaveCount(0);
  await page.locator('#term-clipped').scrollIntoViewIfNeeded();
  await page.locator('#term-clipped').click();
  await expect(card(page)).toBeVisible();
});

test('overlapping passages remain available through the page list without ambiguous click interception', async ({
  sandbox,
  fixtureServer,
}) => {
  const { popup, context } = await sandbox.launch();
  await configureFixtureProvider(popup, fixtureServer.origin);
  const page = await context.newPage();
  await page.goto(fixtureServer.origin + '/article');
  await page.locator('#concept').click({ clickCount: 3 });
  await page.getByRole('button', { name: 'Explain', exact: true }).click();
  await expect(page.getByText('Explanation ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await page.locator('#concept').dblclick({ position: { x: 25, y: 15 } });
  await page.getByRole('button', { name: 'Explain', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Page explanations', exact: true })).toContainText(
    'Saul · 2',
  );
  // Selecting the nested term can open/view the outer passage on the first click.
  await expect(page.getByText(/^(Explanation|2 explanations) ready$/)).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await page.locator('#concept').click({ position: { x: 25, y: 15 } });
  await expect(card(page)).toHaveCount(0);
  await page.keyboard.press('Alt+Shift+KeyL');
  const list = page.getByRole('region', { name: 'Page explanations', exact: true });
  await expect(list.getByRole('button')).toHaveCount(2);
  await list.getByRole('button').first().click();
  await expect(card(page)).toBeVisible();
});
