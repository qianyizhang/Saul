import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures.ts';
import { configureFixtureProvider } from './support.ts';

// Use actual drags across paragraph, bold inline text, and list boundaries.
async function selectAcrossBlocks(
  page: Page,
  backwards = false,
  selectors = { start: '#intro', end: '#ending' },
) {
  const points = await page.evaluate(({ start: startSelector, end: endSelector }) => {
    const start = document.createRange();
    start.setStart(document.querySelector(startSelector)!.firstChild!, 8);
    start.collapse(true);
    const end = document.createRange();
    end.setStart(document.querySelector(endSelector)!.lastChild!, 18);
    end.collapse(true);
    const a = start.getBoundingClientRect();
    const b = end.getBoundingClientRect();
    return [
      { x: a.x, y: a.y + a.height / 2 },
      { x: b.x, y: b.y + b.height / 2 },
    ] as const;
  }, selectors);
  const [start, end] = backwards ? ([points[1], points[0]] as const) : points;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 15 });
  await page.mouse.up();
}

async function lastSelectedCharacter(page: Page) {
  return page.evaluate(() => {
    const range = window.getSelection()!.getRangeAt(0).cloneRange();
    range.setStart(range.endContainer, range.endOffset - 1);
    const rect = range.getBoundingClientRect();
    return { right: rect.right, bottom: rect.bottom };
  });
}

async function expectAtSelectionEnd(page: Page, trigger: Locator) {
  await expect
    .poll(async () => {
      const end = await lastSelectedCharacter(page);
      const box = await trigger.boundingBox();
      return box
        ? Math.max(Math.abs(box.x + box.width - end.right), Math.abs(box.y - end.bottom - 8))
        : Infinity;
    })
    .toBeLessThan(2);
}

for (const backwards of [false, true]) {
  test(`multiline Explain follows the final selected line (${backwards ? 'backward' : 'forward'} drag)`, async ({
    sandbox,
    fixtureServer,
  }, info) => {
    const { context } = await sandbox.launch();
    const page = await context.newPage();
    await page.goto(fixtureServer.origin + '/multiline');
    await expect(page.locator('saul-root')).toBeAttached();
    await selectAcrossBlocks(page, backwards);
    const trigger = page.getByRole('button', { name: 'Explain', exact: true });
    await expect(trigger).toBeVisible();
    await page.screenshot({ path: info.outputPath('multiline-trigger.png') });
    await expectAtSelectionEnd(page, trigger);
    await page.mouse.wheel(0, 70);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(50);
    await expectAtSelectionEnd(page, trigger);
    // With no room below, keep the control just above the first selected line.
    const end = await lastSelectedCharacter(page);
    await page.setViewportSize({ width: 1000, height: Math.ceil(end.bottom + 30) });
    await expect
      .poll(async () => {
        const first = await page.evaluate(() => {
          const rect = window.getSelection()!.getRangeAt(0).getClientRects()[0]!;
          return { top: rect.top, right: rect.right };
        });
        const box = await trigger.boundingBox();
        return box
          ? Math.max(
              Math.abs(box.x + box.width - first.right),
              Math.abs(box.y + box.height + 8 - first.top),
            )
          : Infinity;
      })
      .toBeLessThan(2);
  });
}

test('multiline capture preserves paragraph, list, and explicit line breaks in saved history', async ({
  sandbox,
  fixtureServer,
}) => {
  const { context, popup } = await sandbox.launch();
  await configureFixtureProvider(popup, fixtureServer.origin);
  const page = await context.newPage();
  await page.goto(fixtureServer.origin + '/multiline');
  await expect(page.locator('saul-root')).toBeAttached();
  await selectAcrossBlocks(page);
  const selectedText = await page.evaluate(() => window.getSelection()!.toString().trim());
  expect(selectedText).toMatch(/TypeScript\.\n+Reading:/);
  expect(selectedText).toMatch(/export\.\n+Tabs:/);
  const end = await lastSelectedCharacter(page);
  const lastLine = await page.locator('li strong').nth(1).boundingBox();
  await page.getByRole('button', { name: 'Explain', exact: true }).click();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  const card = page.getByRole('region', { name: 'Saul explanation' });
  await expect(card.getByText('Ready · saved on this device', { exact: false })).toBeVisible();
  const cardBox = (await card.boundingBox())!;
  expect(Math.abs(cardBox.y - end.bottom - 8)).toBeLessThan(2);
  expect(Math.abs(cardBox.x - lastLine!.x)).toBeLessThan(2);
  await expect(card.locator('header span')).toHaveAttribute('title', selectedText);
  const history = await popup.evaluate(() =>
    chrome.runtime.sendMessage({
      target: 'saul-workspace',
      message: { type: 'DB_GET_HISTORY', payload: {} },
    }),
  );
  expect(history.result[0].selectedText).toBe(selectedText);
  await card.getByRole('button', { name: 'Close explanation' }).click();
  const points = await page.locator('#breaks').evaluate((paragraph) => {
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
    const first = rects[0]!,
      last = rects[rects.length - 1]!;
    return [
      { x: first.left, y: first.top + first.height / 2 },
      { x: last.right, y: last.top + last.height / 2 },
    ] as const;
  });
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  await page.mouse.move(points[1].x, points[1].y, { steps: 10 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()!.toString())).toBe(
    'First line\nSecond line\nFinal line',
  );
  await page.getByRole('button', { name: 'Explain', exact: true }).click();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(card.getByText('Ready · saved on this device', { exact: false })).toBeVisible();
  await expect(card.locator('header span')).toHaveAttribute(
    'title',
    'First line\nSecond line\nFinal line',
  );
});

test('live GitHub multiline selection and explanation stay aligned while scrolling', async ({
  sandbox,
  fixtureServer,
}, info) => {
  test.skip(!process.env.SAUL_LIVE_GITHUB, 'Opt-in check against the live GitHub layout');
  const { context, popup } = await sandbox.launch();
  await configureFixtureProvider(popup, fixtureServer.origin);
  const page = await context.newPage();
  await page.goto('https://github.com/qianyizhang/Saul');
  await expect(page.locator('saul-root')).toBeAttached();
  const intro = page.locator('article p').filter({ hasText: 'A local-first Chrome' });
  await intro.scrollIntoViewIfNeeded();
  await selectAcrossBlocks(page, false, {
    start: 'article p',
    end: 'article ul > li:nth-child(2)',
  });
  const trigger = page.getByRole('button', { name: 'Explain', exact: true });
  await expect(trigger).toBeVisible();
  await expectAtSelectionEnd(page, trigger);
  await expect(trigger).toHaveCSS('transition-duration', '0s');
  const beforeScroll = await lastSelectedCharacter(page);
  await page.mouse.wheel(0, 120);
  await expect
    .poll(async () => (await lastSelectedCharacter(page)).bottom)
    .toBeLessThan(beforeScroll.bottom - 60);
  await expectAtSelectionEnd(page, trigger);
  await page.screenshot({ path: info.outputPath('github-multiline-trigger.png') });
  const end = await lastSelectedCharacter(page);
  await trigger.click();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  const card = page.getByRole('region', { name: 'Saul explanation' });
  await expect(card.getByText('Ready · saved on this device', { exact: false })).toBeVisible();
  expect(Math.abs((await card.boundingBox())!.y - end.bottom - 8)).toBeLessThan(2);
  await expect(card).toHaveCSS('transition-duration', '0s');
  await page.screenshot({ path: info.outputPath('github-multiline-explanation.png') });
});
