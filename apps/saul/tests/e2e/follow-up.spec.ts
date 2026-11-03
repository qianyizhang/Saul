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
    await question.fill('Can you give a concrete example?');
    await question.press('ControlOrMeta+Enter');
    await expect.poll(async () => fixtureServer.requests.length).toBe(3);
    await expect
      .poll(async () => (await getFirstHistory(browser.popup)).latest.status)
      .toBe('completed');
    const second = JSON.parse(fixtureServer.requests[2]!.body);
    expect(second.messages[1].content).toContain('Why does that happen?');
    expect(second.messages[1].content).toContain('Can you give a concrete example?');
    for (const minimum of [true, false]) {
      await browser.popup.evaluate(async (minimum) => {
        await chrome.storage.local.set({ saul_minimum_mode: minimum });
      }, minimum);
      await expect(card).toHaveAttribute('data-minimum', String(minimum));
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
