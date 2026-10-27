import { test, expect } from './fixtures.ts';
import { installDigestProvider } from './digest-fixture.ts';
import {
  configureFixtureProvider,
  explainSelection,
  getFirstHistory,
  openFirstPageExplanation,
} from './driver.ts';

test('summary reuse compares input without inference; inspection searches large captures and rerun preserves the old result', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { worker, context, popup } = await sandbox.launch();
  await installDigestProvider(worker);
  const source = await context.newPage();
  await source.goto(fixtureServer.origin + '/article');
  await source.evaluate(() => {
    const block = document.createElement('p');
    block.textContent =
      'Evidence and reasoning, with a long readable paragraph. '.repeat(1600) + '\nEND-OF-CAPTURE';
    (document.querySelector('article') || document.body).append(block);
  });
  const tabId = await worker.evaluate(
    async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)!.id!,
    source.url(),
  );
  async function openReader() {
    const opened = context.waitForEvent('page');
    await popup.evaluate(
      (tabId) =>
        chrome.runtime.sendMessage({
          type: 'WORKSPACE_TABS',
          action: 'command',
          method: 'saul_summary_open',
          args: { tabIds: [tabId] },
        }),
      tabId,
    );
    const reader = await opened;
    await expect(reader.getByRole('status')).toHaveText('Summary ready');
    return reader;
  }
  const first = await openReader();
  const savedRoute = new URL(first.url()).hash;
  const requests = () =>
    worker.evaluate(
      () =>
        (globalThis as unknown as { digestFixture: { requests: unknown[] } }).digestFixture.requests
          .length,
    );
  const initial = await requests();
  const repeated = await openReader();
  expect(new URL(repeated.url()).hash).toBe(savedRoute);
  await expect(repeated.getByRole('complementary', { name: 'Saved summary reused' })).toContainText(
    'Text unchanged',
  );
  expect(await requests()).toBe(initial);
  await source.evaluate(() => {
    document.title = 'Updated article title';
    const block = document.createElement('p');
    block.textContent = 'A newly verified finding changes this article.';
    (document.querySelector('article') || document.body).prepend(block);
  });
  const changed = await openReader();
  const notice = changed.getByRole('complementary', { name: 'Saved summary reused' });
  await expect(notice).toContainText('Text changed');
  await expect(notice).toContainText('Page title');
  expect(await requests()).toBe(initial);
  const inspector = changed.locator('.saul-inspector');
  await inspector.locator(':scope > summary').click();
  const saved = inspector.getByRole('region', { name: 'Captured page text', exact: true });
  await expect(saved.locator('pre')).toBeVisible();
  expect((await saved.locator('pre').textContent())!.length).toBeLessThanOrEqual(6000);
  await saved.getByLabel('Search Captured page text').fill('END-OF-CAPTURE');
  await expect(saved.locator('mark')).toHaveText('END-OF-CAPTURE');
  await inspector.getByRole('button', { name: 'Compare current page' }).click();
  await expect(inspector.getByRole('button', { name: 'Current input', exact: true })).toBeVisible();
  await inspector.getByRole('button', { name: 'Current input', exact: true }).click();
  await expect(
    inspector.getByRole('region', { name: 'Current page text', exact: true }).locator('pre'),
  ).toContainText('newly verified finding');
  for (const colorScheme of ['light', 'dark'] as const) {
    await changed.setViewportSize({ width: 360, height: 860 });
    await changed.emulateMedia({ colorScheme });
    await inspector.scrollIntoViewIfNeeded();
    expect(await changed.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await changed.screenshot({ path: info.outputPath(`summary-inspection-${colorScheme}.png`) });
  }
  expect(await requests()).toBe(initial);
  await changed.getByRole('button', { name: 'Run again', exact: true }).click();
  await expect.poll(() => new URL(changed.url()).hash).not.toBe(savedRoute);
  await expect(changed.getByRole('status')).toHaveText('Summary ready');
  const generations = await worker.evaluate(() =>
    (
      globalThis as unknown as {
        digestFixture: { requests: { action: string; userPrompt?: string }[] };
      }
    ).digestFixture.requests.filter((r) => r.action === 'generate'),
  );
  expect(generations).toHaveLength(2);
  expect(generations[1]!.userPrompt).toContain('newly verified finding');
  await first.reload();
  await expect(first.getByRole('heading', { level: 2 })).toHaveText('Calculus reading fixture');
  await expect(first.getByRole('status')).toHaveText('Summary ready');
  await changed.locator('.saul-inspector > summary').click();
  await changed.getByRole('button', { name: 'Compare current page' }).click();
  await changed.getByRole('button', { name: 'Current input', exact: true }).click();
  await source.close();
  await changed.getByRole('button', { name: 'Compare current page' }).click();
  await expect(changed.locator('.saul-inspector')).toContainText('Current input not verified');
  await expect(
    changed.getByRole('region', { name: 'Captured page text', exact: true }).locator('pre'),
  ).toBeVisible();
});

test('repeated reading actions disclose reuse and input drift, then explicitly run fresh input', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { context, popup } = await sandbox.launch();
  await configureFixtureProvider(popup, fixtureServer.origin);
  const source = await context.newPage();
  await source.goto(fixtureServer.origin + '/article');
  const initial = fixtureServer.requests.length;
  await explainSelection(source);
  await expect.poll(async () => (await getFirstHistory(popup)).latest.status).toBe('completed');
  await openFirstPageExplanation(source);
  await source.getByRole('button', { name: 'Close explanation', exact: true }).click();
  await explainSelection(source);
  const notice = source.getByRole('complementary', { name: 'Saved result reused' });
  await expect(notice).toContainText('Text unchanged');
  expect(fixtureServer.requests.length).toBe(initial + 1);
  await source.getByRole('button', { name: 'Close explanation', exact: true }).click();
  await source.locator('#concept').evaluate((element) => {
    element.parentElement!.append(' Additional evidence beyond the captured context.');
    document.title = 'Updated context for the same selected passage';
  });
  await explainSelection(source);
  await expect(notice).toContainText('Text changed');
  expect(fixtureServer.requests.length).toBe(initial + 1);
  await source.screenshot({ path: info.outputPath('reading-reuse.png') });
  await notice.getByRole('button', { name: 'Run again with current input', exact: true }).click();
  await expect.poll(() => fixtureServer.requests.length).toBe(initial + 2);
  await expect.poll(async () => (await getFirstHistory(popup)).latest.status).toBe('completed');
  expect(fixtureServer.requests.at(-1)!.body).toContain(
    'Updated context for the same selected passage',
  );
});

test('repeated actions reopen active and stopped attempts without automatic generation', async ({
  sandbox,
  fixtureServer,
}) => {
  const { context, worker, popup } = await sandbox.launch();
  await installDigestProvider(worker, true);
  const source = await context.newPage();
  await source.goto(fixtureServer.origin + '/article');
  const tabId = await worker.evaluate(
    async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)!.id!,
    source.url(),
  );
  async function openReader() {
    const opened = context.waitForEvent('page');
    await popup.evaluate(
      (tabId) =>
        chrome.runtime.sendMessage({
          type: 'WORKSPACE_TABS',
          action: 'command',
          method: 'saul_summary_open',
          args: { tabIds: [tabId] },
        }),
      tabId,
    );
    return opened;
  }
  const first = await openReader();
  await expect(first.getByRole('status')).toHaveText('Generating summary…');
  const id = new URL(first.url()).hash;
  const initial = await worker.evaluate(
    () =>
      (globalThis as unknown as { digestFixture: { requests: unknown[] } }).digestFixture.requests
        .length,
  );
  const active = await openReader();
  await expect(active.getByRole('status')).toHaveText('Generating summary…');
  await expect(active.getByRole('complementary', { name: 'Saved summary reused' })).toContainText(
    'Existing summary reopened',
  );
  expect(new URL(active.url()).hash).toBe(id);
  await active.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(active.getByRole('status')).toHaveText('Summary stopped');
  const stopped = await openReader();
  await expect(stopped.getByRole('status')).toHaveText('Summary stopped');
  await expect(stopped.getByRole('complementary', { name: 'Saved summary reused' })).toContainText(
    'Saved attempt reopened',
  );
  expect(new URL(stopped.url()).hash).toBe(id);
  expect(
    await worker.evaluate(
      () =>
        (globalThis as unknown as { digestFixture: { requests: unknown[] } }).digestFixture.requests
          .length,
    ),
  ).toBe(initial);
});
