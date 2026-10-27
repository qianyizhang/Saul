import { test, expect } from './fixtures.ts';
import { installDigestProvider } from './digest-fixture.ts';
import type { PlanRequest } from '../../native/plan-protocol.mts';
import type { DigestBatch } from '../../src/digest/types';
import { readFile } from 'node:fs/promises';

test('programmatic summary opens immediately, runs two streams, survives closure and persists with export', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { worker, context, popup } = await sandbox.launch();
  await installDigestProvider(worker, true);
  const sources = [];
  for (let i = 0; i < 3; i++) {
    const page = await context.newPage();
    await page.goto(fixtureServer.origin + '/article#summary=' + i);
    await page.evaluate((i) => {
      document.title = 'Summary source ' + i;
    }, i);
    sources.push(page);
  }
  await sources[1]!.setContent(
    '<title>Summary source 1</title><article>' +
      'Article evidence. '.repeat(25) +
      '</article><section id="comments">A loaded discussion counterargument.</section>',
  );
  const denied = await worker.evaluate(async () => {
    const tab = (await chrome.tabs.query({})).find((t) => t.url?.includes('/article#summary=0'))!;
    return (
      await chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        func: () =>
          chrome.runtime.sendMessage({ target: 'saul-digest', message: { action: 'list' } }),
      })
    )[0]!.result;
  });
  expect(denied).toMatchObject({ success: false, error: 'Extension workspace only' });
  await popup.getByRole('button', { name: 'Window', exact: true }).click();
  for (let i = 0; i < 3; i++)
    await popup.getByRole('checkbox', { name: 'Select Summary source ' + i, exact: true }).check();
  const readerPromise = context.waitForEvent('page');
  await popup.evaluate(
    async (urls) => {
      const tabs = await chrome.tabs.query({});
      const tabIds = urls.map((url) => tabs.find((tab) => tab.url === url)!.id!);
      await chrome.runtime.sendMessage({
        type: 'WORKSPACE_TABS',
        action: 'command',
        method: 'saul_summary_open',
        args: { tabIds },
      });
    },
    sources.map((source) => source.url()),
  );
  const reader = await readerPromise;
  await expect(reader.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await expect
    .poll(() =>
      worker.evaluate(
        () => (globalThis as unknown as { digestFixture: { active: number } }).digestFixture.active,
      ),
    )
    .toBe(2);
  const readerUrl = reader.url();
  await reader.close();
  await popup.close();
  const reopened = await context.newPage();
  await reopened.goto(readerUrl);
  await expect(reopened.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await reopened.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(reopened.getByRole('button', { name: 'Retry unfinished' })).toBeVisible();
  await sources[0]!.close();
  await worker.evaluate(() => {
    (globalThis as unknown as { digestFixture: { hold: boolean } }).digestFixture.hold = false;
  });
  await reopened.getByRole('button', { name: 'Retry unfinished' }).click();
  await expect(reopened.getByRole('status')).toContainText('3 of 3 summarized');
  await expect(reopened.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  const downloading = reopened.waitForEvent('download');
  await reopened.getByRole('button', { name: 'Export HTML' }).click();
  const html = await readFile((await (await downloading).path())!, 'utf8');
  expect(html).toContain('/article#summary=0');
  expect(html.indexOf('A concise source-backed finding.')).toBeLessThan(
    html.indexOf('简明且基于来源的结论。'),
  );
  expect(html).not.toContain('accountId');
  const evidence = await worker.evaluate(() => {
    const state = (
      globalThis as unknown as { digestFixture: { requests: PlanRequest[]; maxActive: number } }
    ).digestFixture;
    return {
      maxActive: state.maxActive,
      requests: state.requests.filter((r) => r.action === 'generate'),
    };
  });
  expect(evidence.maxActive).toBe(2);
  expect(evidence.requests).toHaveLength(5);
  expect(
    evidence.requests.some(
      (r) => r.action === 'generate' && r.userPrompt.includes('loaded discussion counterargument'),
    ),
  ).toBe(true);
  await reopened.screenshot({ path: info.outputPath('summary-reader.png'), fullPage: true });
  await reopened.setViewportSize({ width: 420, height: 760 });
  await reopened.emulateMedia({ colorScheme: 'dark' });
  await reopened.screenshot({
    path: info.outputPath('summary-reader-dark-narrow.png'),
    fullPage: true,
  });
  expect(await reopened.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  const id = new URL(readerUrl).hash.slice('#summary/'.length).split('?')[0]!;
  const relaunched = await sandbox.launch();
  await relaunched.popup.getByRole('button', { name: 'Summaries', exact: true }).click();
  await expect(
    relaunched.popup.getByRole('region', { name: 'Saved summaries' }).getByRole('button'),
  ).toHaveCount(1);
  const batch = await relaunched.popup.evaluate(async (id) => {
    const reply = await chrome.runtime.sendMessage({
      target: 'saul-digest',
      message: { action: 'get', id },
    });
    return reply.result as DigestBatch;
  }, id);
  expect(batch.items.map((i) => i.status)).toEqual(['completed', 'completed', 'completed']);
  expect(batch.items.map((i) => i.url)).toEqual(
    [0, 1, 2].map((i) => fixtureServer.origin + '/article#summary=' + i),
  );
});
