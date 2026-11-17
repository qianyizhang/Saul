import { test, expect } from './fixtures.ts';
import { configureFixtureProvider, createFixtureServer } from './support.ts';
import {
  explainSelection,
  getFirstHistory,
  getHistory,
  openFirstPageExplanation,
  sendDb,
} from './driver.ts';

test('widget follow-ups preserve drafts, context, failures and saved history', async ({
  sandbox,
}, info) => {
  const fixtureServer = await createFixtureServer();
  try {
    let browser = await sandbox.launch();
    await configureFixtureProvider(browser.popup, fixtureServer.origin);
    let page = await browser.context.newPage();
    await page.goto(fixtureServer.origin + '/article');
    await explainSelection(page);
    await expect
      .poll(async () => (await getHistory(browser.popup))[0]?.latest.status)
      .toBe('completed');
    await openFirstPageExplanation(page);
    const card = page.getByRole('region', { name: 'Saul explanation' });
    const question = card.getByRole('textbox', { name: 'Ask a follow-up' });
    const send = card.getByRole('button', { name: 'Send follow-up' });
    await expect(send).toBeDisabled();
    await expect(send).toHaveText('');
    await expect(send).toHaveAttribute('title', 'Send follow-up');
    await browser.context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: fixtureServer.origin,
    });
    const copy = card.getByRole('button', { name: 'Copy explanation', exact: true });
    await expect(copy).toHaveText('');
    await copy.click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain('steepest increase');
    await expect(copy).toHaveAttribute('title', 'Copied explanation');
    expect(fixtureServer.requests).toHaveLength(1);
    await question.fill('Why does that happen?');
    await card.getByRole('button', { name: 'Close explanation' }).click();
    await openFirstPageExplanation(page);
    await expect(question).toHaveValue('Why does that happen?');
    await send.click();
    await expect.poll(async () => fixtureServer.requests.length).toBe(2);
    await expect
      .poll(async () => (await getFirstHistory(browser.popup)).latest.status)
      .toBe('completed');
    await expect(question).toHaveValue('');
    await expect(card.getByText('Why does that happen?', { exact: true })).toBeVisible();
    const first = JSON.parse(fixtureServer.requests[1]!.body);
    expect(first.messages[1].content).toContain('Gradient descent');
    expect(first.messages[1].content).toContain('steepest increase');
    expect(first.messages[1].content).toContain('Why does that happen?');
    await question.fill('abcDEF');
    await question.evaluate((input: HTMLTextAreaElement) => input.setSelectionRange(3, 4));
    await question.press('Shift+Enter');
    await expect(question).toHaveValue('abc\nEF');
    await question.press('Enter');
    await expect(question).toHaveValue('abc\n\nEF');
    await expect(question).toBeFocused();
    expect(fixtureServer.requests).toHaveLength(2);
    await question.fill('Can you give a concrete example?');
    const ignored = await question.evaluate((input) =>
      [
        { metaKey: true, shiftKey: true },
        { ctrlKey: true, altKey: true },
        { ctrlKey: true, metaKey: true },
        { metaKey: true, repeat: true },
        { metaKey: true, isComposing: true },
      ].map((flags) =>
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...flags }),
        ),
      ),
    );
    expect(ignored).toEqual([true, true, true, true, true]);
    await expect(question).toHaveValue('Can you give a concrete example?');
    await question.press('ControlOrMeta+Enter');
    await expect.poll(async () => fixtureServer.requests.length).toBe(3);
    await expect
      .poll(async () => (await getFirstHistory(browser.popup)).latest.status)
      .toBe('completed');
    const second = JSON.parse(fixtureServer.requests[2]!.body);
    expect(second.messages[1].content).toContain('Why does that happen?');
    expect(second.messages[1].content).toContain('Can you give a concrete example?');
    // Inspect the same earlier attempt in both consumers of PastAttemptContent.
    await card.getByRole('button', { name: 'More', exact: true }).click();
    await card.getByRole('button', { name: 'Past attempts', exact: true }).click();
    const earlierCard = card
      .locator('details')
      .filter({
        has: page.getByText('Why does that happen?', { exact: true }),
      })
      .last();
    await earlierCard.locator(':scope > summary').click();
    await expect(earlierCard.getByText('Why does that happen?', { exact: true })).toBeVisible();
    await earlierCard.locator('.saul-inspector > summary').click();
    await expect(
      earlierCard.getByRole('region', { name: 'Prompt · user', exact: true }).locator('pre'),
    ).toHaveText(first.messages[1].content);
    await browser.popup.getByRole('button', { name: 'History', exact: true }).click();
    await browser.popup.locator('.history-title').click();
    await browser.popup.locator('.history-more > summary').click();
    const earlierHistory = browser.popup.locator('.history-more > details').filter({
      has: browser.popup.getByText('Why does that happen?', { exact: true }),
    });
    await earlierHistory.locator(':scope > summary').click();
    await expect(earlierHistory.getByText('Why does that happen?', { exact: true })).toBeVisible();
    await earlierHistory.locator('.saul-inspector > summary').click();
    await expect(
      earlierHistory.getByRole('region', { name: 'Prompt · user', exact: true }).locator('pre'),
    ).toHaveText(first.messages[1].content);
    expect(fixtureServer.requests).toHaveLength(3);
    if (process.env.SAUL_CAPTURE_REVIEW === '1')
      await browser.popup.screenshot({
        path: info.outputPath('past-attempt-history.png'),
        fullPage: true,
      });
    await card.getByRole('button', { name: 'Past attempts', exact: true }).click();
    await card.getByRole('button', { name: 'More', exact: true }).click();
    for (const minimum of [true, false]) {
      await browser.popup.evaluate(async (minimum) => {
        await chrome.storage.local.set({ saul_minimum_mode: minimum });
      }, minimum);
      await expect(card).toHaveAttribute('data-minimum', String(minimum));
      await expect(send).toHaveText('');
      await expect(copy).toHaveText('');
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        for (const width of [360, 1000]) {
          await page.setViewportSize({ width, height: 760 });
          await expect(send).toBeInViewport();
          await expect(question).toBeInViewport();
          if (process.env.SAUL_CAPTURE_REVIEW === '1')
            await page.screenshot({
              path: info.outputPath(
                `follow-up-${minimum ? 'min' : 'standard'}-${colorScheme}-${width}.png`,
              ),
            });
        }
      }
    }
    fixtureServer.setEnding('eof');
    await question.fill('What happens if it fails?');
    await send.click();
    await expect
      .poll(async () => (await getFirstHistory(browser.popup)).latest.status)
      .toBe('interrupted');
    await expect(card.getByText('Can you give a concrete example?', { exact: true })).toBeVisible();
    await expect(card.getByRole('alert')).toBeVisible();
    fixtureServer.setEnding('done');
    fixtureServer.setGated(true);
    await question.fill('Keep the successful context');
    await send.click();
    await expect
      .poll(async () => (await getFirstHistory(browser.popup)).latest.status)
      .toBe('running');
    await expect(send).toBeDisabled();
    await card.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect
      .poll(async () => (await getFirstHistory(browser.popup)).latest.status)
      .toBe('cancelled');
    const calls = fixtureServer.requests.length;
    browser = await sandbox.launch();
    page = await browser.context.newPage();
    await page.goto(fixtureServer.origin + '/article');
    await openFirstPageExplanation(page);
    await expect(page.getByText('Can you give a concrete example?', { exact: true })).toBeVisible();
    await browser.popup.locator('.history-title').click();
    await expect(
      browser.popup.getByText('Can you give a concrete example?', { exact: true }),
    ).toBeVisible();
    const exported = await sendDb(browser.popup, {
      type: 'DB_EXPORT_MARKDOWN',
      payload: undefined,
    });
    expect(exported).toContain('Follow-up: Why does that happen?');
    expect(exported).toContain('Follow-up: Can you give a concrete example?');
    expect(fixtureServer.requests.length).toBe(calls);
  } finally {
    await fixtureServer.close();
  }
});
