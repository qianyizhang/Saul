import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures.ts';
import { configureFixtureProvider } from './support.ts';

async function selectionBox(page: Page) {
  return page.evaluate(() => {
    const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
}

async function expectBelowSelection(page: Page, floating: Locator) {
  await expect
    .poll(async () => {
      const anchor = await selectionBox(page);
      const box = await floating.boundingBox();
      return box ? Math.abs(box.y - (anchor.y + anchor.height + 8)) : Infinity;
    })
    .toBeLessThan(2);
}

test('Explain appears immediately without movement animations', async ({
  sandbox,
  fixtureServer,
}) => {
  const { context } = await sandbox.launch();
  const article = await context.newPage();
  await article.goto(fixtureServer.origin + '/article');
  await expect(article.locator('saul-root')).toBeAttached();
  await article.locator('#concept').click({ clickCount: 3 });
  const trigger = article.getByRole('button', { name: 'Explain', exact: true });
  await expect(trigger).toBeVisible();
  const motion = await trigger.evaluate((element) => {
    const style = getComputedStyle(element);
    return { transition: style.transitionDuration, animation: style.animationName };
  });
  expect(motion).toEqual({ transition: '0s', animation: 'none' });
  await expectBelowSelection(article, trigger);
});

test('Explain stays next to the selection on a long positioned page while scrolling', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { context, popup } = await sandbox.launch();
  await configureFixtureProvider(popup, fixtureServer.origin);
  const article = await context.newPage();
  await article.goto(fixtureServer.origin + '/article');
  await expect(article.locator('saul-root')).toBeAttached();
  await article.addStyleTag({
    content: 'body { position: relative; min-height: 4000px } #concept { margin-top: 1400px }',
  });
  await article.locator('#concept').scrollIntoViewIfNeeded();
  await article.locator('#concept').click({ clickCount: 3 });
  const trigger = article.getByRole('button', { name: 'Explain', exact: true });
  await expect(trigger).toBeVisible();
  await expectBelowSelection(article, trigger);
  const beforeScroll = await selectionBox(article);
  await article.mouse.wheel(0, 120);
  await expect.poll(async () => (await selectionBox(article)).y).toBeLessThan(beforeScroll.y - 60);
  await expectBelowSelection(article, trigger);
  await article.screenshot({ path: info.outputPath('scrolled-trigger.png') });
  const anchor = await selectionBox(article);
  await trigger.click();
  await article.getByRole('button', { name: 'View', exact: true }).click();
  const card = article.getByRole('region', { name: 'Saul explanation' });
  await expect(card.getByText('Ready · saved on this device', { exact: false })).toBeVisible();
  const box = (await card.boundingBox())!;
  const currentAnchor = await article.locator('#concept').evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect().bottom;
  });
  expect(Math.abs(box.y - currentAnchor - 8)).toBeLessThan(2);
  await article.screenshot({ path: info.outputPath('scrolled-explanation.png') });
});

test('Explain follows text layout changes inside an unchanged container', async ({
  sandbox,
  fixtureServer,
}) => {
  const { context } = await sandbox.launch();
  const page = await context.newPage();
  await page.goto(fixtureServer.origin + '/article');
  await expect(page.locator('saul-root')).toBeAttached();
  await page.addStyleTag({ content: '#concept { height: 320px; box-sizing: border-box }' });
  await page.locator('#concept').click({ clickCount: 3, position: { x: 80, y: 15 } });
  const trigger = page.getByRole('button', { name: 'Explain', exact: true });
  await expectBelowSelection(page, trigger);
  const before = await page.locator('#concept').boundingBox();
  await page.locator('#concept').evaluate((paragraph) => {
    paragraph.style.paddingTop = '140px';
  });
  expect(await page.locator('#concept').boundingBox()).toEqual(before);
  await expectBelowSelection(page, trigger);
});

test('captured highlight stays anchored when the host changes the browser selection', async ({
  sandbox,
  fixtureServer,
}) => {
  const { context } = await sandbox.launch();
  const page = await context.newPage();
  await page.goto(fixtureServer.origin + '/article');
  await expect(page.locator('saul-root')).toBeAttached();
  await page.locator('#concept').click({ clickCount: 3 });
  const trigger = page.getByRole('button', { name: 'Explain', exact: true });
  await expectBelowSelection(page, trigger);
  const original = (await trigger.boundingBox())!;
  await page.evaluate(async () => {
    window.getSelection()!.getRangeAt(0).selectNodeContents(document.querySelector('h1')!);
    window.dispatchEvent(new Event('resize'));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  const current = (await trigger.boundingBox())!;
  expect(Math.abs(current.x - original.x)).toBeLessThan(2);
  expect(Math.abs(current.y - original.y)).toBeLessThan(2);
});
