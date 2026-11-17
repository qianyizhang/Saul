import { summaryMore } from './driver.ts';
import { reviewScreenshots } from './artifacts.ts';
import { test, expect } from './fixtures.ts';
import { installDigestProvider, openDigestReader } from './digest-fixture.ts';
import type { PlanRequest } from '../../native/plan-protocol.mts';
import type { DigestBatch } from '../../src/digest/types';
import { readFile } from 'node:fs/promises';

test('summary status recovers from lost reads without repeating a start or inference', async ({
  sandbox,
  fixtureServer,
}) => {
  const { worker, context, popup } = await sandbox.launch();
  await installDigestProvider(worker, true);
  await context.addInitScript(() => {
    if (location.protocol !== 'chrome-extension:') return;
    const original = chrome.runtime.sendMessage.bind(chrome.runtime) as (
      input: unknown,
    ) => Promise<unknown>;
    const gate = Promise.withResolvers<void>();
    const probe = { starts: 0, reads: 0, inFlight: 0, maxInFlight: 0, release: gate.resolve };
    Object.assign(globalThis, { summaryStatusProbe: probe });
    chrome.runtime.sendMessage = (async (input: {
      target?: string;
      message?: { action?: string };
    }) => {
      if (input.target !== 'saul-digest') return original(input);
      if (input.message?.action === 'start') probe.starts++;
      if (input.message?.action !== 'get') return original(input);
      const read = ++probe.reads;
      probe.inFlight++;
      probe.maxInFlight = Math.max(probe.inFlight, probe.maxInFlight);
      try {
        if (read === 1 || read === 3)
          return { success: false, error: 'Fixture temporarily lost the summary status read.' };
        if (read === 4) await gate.promise;
        return await original(input);
      } finally {
        probe.inFlight--;
      }
    }) as typeof chrome.runtime.sendMessage;
  });
  const source = await context.newPage();
  await source.goto(fixtureServer.origin + '/article');
  const reader = await openDigestReader(context, popup, worker, source.url());
  const failure = reader.getByRole('alert').filter({ hasText: 'Could not read summary status' });
  await expect(failure).toBeVisible();
  const refresh = reader.getByRole('button', { name: 'Refresh status', exact: true });
  await refresh.click();
  await expect(reader.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await expect(failure).toBeVisible();
  await refresh.click();
  await refresh.click();
  const beforeRecovery = await reader.evaluate(() => {
    const probe = (
      globalThis as typeof globalThis & {
        summaryStatusProbe: { starts: number; reads: number; maxInFlight: number };
      }
    ).summaryStatusProbe;
    return { starts: probe.starts, reads: probe.reads, maxInFlight: probe.maxInFlight };
  });
  expect(beforeRecovery).toEqual({ starts: 1, reads: 4, maxInFlight: 1 });
  await expect
    .poll(() =>
      worker.evaluate(
        () =>
          (globalThis as typeof globalThis & { digestFixture: { active: number } }).digestFixture
            .active,
      ),
    )
    .toBe(1);
  const inference = await worker.evaluate(() => {
    const state = (
      globalThis as typeof globalThis & {
        digestFixture: { requests: PlanRequest[]; finishes: Map<string, () => void> };
      }
    ).digestFixture;
    for (const finish of state.finishes.values()) finish();
    return state.requests.filter((request) => request.action === 'generate').length;
  });
  expect(inference).toBe(1);
  await reader.evaluate(() => {
    (
      globalThis as typeof globalThis & { summaryStatusProbe: { release: () => void } }
    ).summaryStatusProbe.release();
  });
  await expect(reader.getByRole('status')).toHaveText('Summary ready');
  await expect(failure).toHaveCount(0);
  await expect(reader.getByText('A concise source-backed finding.').first()).toBeVisible();
});

test('a rejected summary result remains unavailable until the user retries', async ({
  sandbox,
  fixtureServer,
}) => {
  const { worker, context, popup } = await sandbox.launch();
  await installDigestProvider(worker);
  const source = await context.newPage();
  await source.goto(fixtureServer.origin + '/article');
  const calls = () =>
    worker.evaluate(
      () =>
        (
          globalThis as unknown as { digestFixture: { requests: PlanRequest[] } }
        ).digestFixture.requests.filter((request) => request.action === 'generate').length,
    );
  sandbox.rejectHistoryWriteOnce(
    ({ type, payload }) =>
      type === 'DB_DIGEST_ITEM' &&
      (payload as { item: { status: string } }).item.status === 'completed',
  );
  const reader = await openDigestReader(context, popup, worker, source.url());
  await expect(reader.getByRole('alert')).toContainText('Could not save summary progress');
  await expect(reader.getByText('A concise source-backed finding.').first()).toHaveCount(0);
  expect(await calls()).toBe(1);
  await reader.reload();
  await expect(reader.getByRole('alert')).toContainText('Could not save summary progress');
  expect(await calls()).toBe(1);
  await reader.getByRole('button', { name: 'Retry unfinished', exact: true }).click();
  await expect(reader.getByRole('status')).toContainText('Summary ready');
  await expect(reader.getByText('A concise source-backed finding.').first()).toBeVisible();
  expect(await calls()).toBe(2);
});

test('programmatic summary opens immediately, runs two streams, survives closure and persists with export @smoke', async ({
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
  await summaryMore(reopened);
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
  if (reviewScreenshots)
    await reopened.screenshot({ path: info.outputPath('summary-reader.png'), fullPage: true });
  await reopened.setViewportSize({ width: 420, height: 760 });
  await reopened.emulateMedia({ colorScheme: 'dark' });
  if (reviewScreenshots)
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
