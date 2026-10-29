import type { Page, Worker } from '@playwright/test';
import { test, expect } from './fixtures.ts';
import { installDigestProvider, openDigestReader } from './digest-fixture.ts';
import { pdfFixture } from '../pdf-fixture.ts';
import type { PlanRequest } from '../../native/plan-protocol.mts';
import type { DigestInspection } from '../../src/digest/types';

const evidence = 'Source evidence in a PDF about incentives for innovation. '.repeat(8);
function id(reader: Page) {
  return decodeURIComponent(new URL(reader.url()).hash.slice('#summary/'.length).split('?')[0]!);
}
async function inspect(reader: Page): Promise<DigestInspection> {
  return reader.evaluate(
    async (id) =>
      (
        await chrome.runtime.sendMessage({
          target: 'saul-digest',
          message: { action: 'inspect', id, index: 0 },
        })
      ).result,
    id(reader),
  );
}
async function requests(worker: Worker) {
  return worker.evaluate(() =>
    (
      globalThis as unknown as { digestFixture: { requests: PlanRequest[] } }
    ).digestFixture.requests.filter((r) => r.action === 'generate'),
  );
}
async function choosePdfProcessing(settings: Page, mode: 'local' | 'attachment') {
  await settings.getByRole('button', { name: 'Settings', exact: true }).click();
  await settings.getByLabel('PDF processing', { exact: true }).selectOption(mode);
  await settings.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(settings.getByText('Saved', { exact: true })).toBeVisible();
}

test('default PDF URL attachments never download bytes, do not claim text equality, and expose exact input', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { context, worker, popup } = await sandbox.launch();
  await installDigestProvider(worker);
  for (const path of ['/attached.pdf?token=public-test#page=2', '/download-pdf?id=49']) {
    fixtureServer.setDocument(path.split('?')[0]!, { body: pdfFixture([evidence, evidence]) });
    const source = await context.newPage();
    await source.goto(fixtureServer.origin + path);
    // Waiting for Chrome's viewer before measuring excludes its own requests.
    const tabId = await worker.evaluate(
      async (url) => (await chrome.tabs.query({})).find((t) => t.url === url)!.id!,
      source.url(),
    );
    await expect
      .poll(() => worker.evaluate(async (id) => (await chrome.tabs.get(id)).status, tabId))
      .toBe('complete');
    const downloads = fixtureServer.documentRequests.length;
    const reader = await openDigestReader(context, popup, worker, source.url());
    await expect(reader.getByRole('status')).toHaveText('Summary ready');
    expect(fixtureServer.documentRequests).toHaveLength(downloads);
    const saved = (await inspect(reader)).saved!;
    expect(saved.kind).toBe('pdf-url');
    expect(saved).not.toHaveProperty('text');
    const url = new URL(source.url());
    url.hash = '';
    expect((await requests(worker)).at(-1)).toHaveProperty('attachments', [
      { type: 'pdf-url', url: url.href },
    ]);
    await expect(
      reader.getByText('Original document contents are not stored', { exact: false }).first(),
    ).toBeVisible();
    await reader.locator('.saul-inspector > summary').click();
    await expect(
      reader.getByRole('region', { name: 'PDF URL attachment', exact: true }).locator('pre'),
    ).toContainText(url.href);
    await reader.getByRole('button', { name: 'Compare current page' }).click();
    await expect(reader.locator('.saul-inspector')).toContainText(
      'matching URL does not prove unchanged contents',
    );
    await expect(reader.locator('.saul-inspector')).not.toContainText('Text unchanged');
    expect(fixtureServer.documentRequests).toHaveLength(downloads);
    const repeated = await openDigestReader(context, popup, worker, source.url());
    await expect(
      repeated.getByRole('complementary', { name: 'Saved summary reused' }),
    ).toContainText('PDF contents not compared');
    expect(await requests(worker)).toHaveLength(path.startsWith('/attached') ? 1 : 2);
    await reader.setViewportSize({ width: 420, height: 850 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await reader.emulateMedia({ colorScheme });
      expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await reader.screenshot({
        path: info.outputPath(
          `attachment-${path.startsWith('/attached') ? 'pdf' : 'extensionless'}-${colorScheme}.png`,
        ),
        fullPage: true,
      });
    }
  }
});

test('PDF processing saves through Settings; changing it preserves old results and Run again uses local text', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { context, worker, popup } = await sandbox.launch();
  await installDigestProvider(worker);
  fixtureServer.setDocument('/choice.pdf', { body: pdfFixture([evidence]) });
  const source = await context.newPage();
  await source.goto(fixtureServer.origin + '/choice.pdf');
  const first = await openDigestReader(context, popup, worker, source.url());
  await expect(first.getByRole('status')).toHaveText('Summary ready');
  const originalId = id(first);
  await choosePdfProcessing(popup, 'local');
  for (const colorScheme of ['light', 'dark'] as const) {
    await popup.emulateMedia({ colorScheme });
    await popup.setViewportSize({ width: 420, height: 850 });
    await popup.getByLabel('PDF processing', { exact: true }).scrollIntoViewIfNeeded();
    await popup.screenshot({ path: info.outputPath(`pdf-settings-${colorScheme}.png`) });
  }
  await popup.reload();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(popup.getByLabel('PDF processing', { exact: true })).toHaveValue('local');
  const reused = await openDigestReader(context, popup, worker, source.url());
  await expect(reused.getByRole('complementary', { name: 'Saved summary reused' })).toContainText(
    'PDF processing',
  );
  expect(id(reused)).toBe(originalId);
  expect(await requests(worker)).toHaveLength(1);
  await reused.getByRole('button', { name: 'Run again', exact: true }).click();
  await expect.poll(() => id(reused)).not.toBe(originalId);
  await expect(reused.getByRole('status')).toHaveText('Summary ready');
  const local = (await inspect(reused)).saved!;
  if (local.kind === 'pdf-url') throw new Error('Expected local source');
  expect(local.text).toContain('incentives for innovation');
  expect((await requests(worker)).at(-1)).not.toHaveProperty('attachments');
  expect((await inspect(first)).saved).toHaveProperty('kind', 'pdf-url');
  // A corrupt new preference must not make saved results unreadable or cause a
  // new run to silently choose another processing method.
  const generations = (await requests(worker)).length;
  await popup.evaluate(async () => {
    await chrome.storage.local.set({ saul_user_settings: { summaryPdfProcessing: 'invalid' } });
  });
  const recovered = await openDigestReader(context, popup, worker, source.url());
  await expect(recovered.getByRole('status')).toHaveText('Summary ready');
  await expect(
    recovered.getByRole('complementary', { name: 'Saved summary reused' }),
  ).toBeVisible();
  expect(await requests(worker)).toHaveLength(generations);
  await recovered.getByRole('button', { name: 'Run again', exact: true }).click();
  await expect(recovered.getByRole('alert')).toContainText('Saved PDF processing');
  expect(await requests(worker)).toHaveLength(generations);
});

test('server attachment failure remains explicit and never falls back to local downloading', async ({
  sandbox,
  fixtureServer,
}) => {
  const { context, worker, popup } = await sandbox.launch();
  await installDigestProvider(worker, false, 'The provider could not read this file URL.');
  fixtureServer.setDocument('/private.pdf', { body: pdfFixture([evidence]) });
  const source = await context.newPage();
  await source.goto(fixtureServer.origin + '/private.pdf');
  const reader = await openDigestReader(context, popup, worker, source.url());
  await expect(reader.getByRole('status')).toHaveText('Could not summarize page');
  await expect(reader.getByText('No local fallback was used', { exact: false })).toBeVisible();
  const downloads = fixtureServer.documentRequests.length;
  const compared = await openDigestReader(context, popup, worker, source.url());
  await expect(compared.getByRole('complementary', { name: 'Saved summary reused' })).toBeVisible();
  expect(fixtureServer.documentRequests).toHaveLength(downloads);
  expect(await requests(worker)).toHaveLength(1);
});

test('attachment Retry preserves the saved URL and method after restart, preference change and source closure', async ({
  sandbox,
  fixtureServer,
}) => {
  const { context, worker, popup } = await sandbox.launch();
  await installDigestProvider(worker, true);
  fixtureServer.setDocument('/retry-attachment.pdf', { body: pdfFixture([evidence]) });
  const source = await context.newPage();
  await source.goto(fixtureServer.origin + '/retry-attachment.pdf');
  const reader = await openDigestReader(context, popup, worker, source.url());
  await expect(reader.getByRole('status')).toHaveText('Generating summary…');
  await reader.getByRole('button', { name: 'Stop', exact: true }).click();
  const saved = (await inspect(reader)).saved;
  await choosePdfProcessing(popup, 'local');
  await source.close();
  const route = reader.url();
  const downloads = fixtureServer.documentRequests.length;
  const reopened = await sandbox.launch();
  await installDigestProvider(reopened.worker);
  const restored = await reopened.context.newPage();
  await restored.goto(route);
  expect((await inspect(restored)).saved).toEqual(saved);
  await restored.getByRole('button', { name: 'Retry unfinished' }).click();
  await expect(restored.getByRole('status')).toHaveText('Summary ready');
  expect((await requests(reopened.worker)).at(-1)).toHaveProperty('attachments', [
    { type: 'pdf-url', url: fixtureServer.origin + '/retry-attachment.pdf' },
  ]);
  expect(fixtureServer.documentRequests).toHaveLength(downloads);
});
