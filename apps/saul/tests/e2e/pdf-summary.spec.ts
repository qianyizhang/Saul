import { readFile } from 'node:fs/promises';
import type { Page, Worker } from '@playwright/test';
import { test, expect } from './fixtures.ts';
import { installDigestProvider, openDigestReader as openReader } from './digest-fixture.ts';
import { pdfFixture } from '../pdf-fixture.ts';
import type { PlanRequest } from '../../native/plan-protocol.mts';
import type { DigestBatch, DigestInspection } from '../../src/digest/types';

// This suite remains the local-parser regression; server attachments have their
// own suite and never opt into this preference implicitly.
test.beforeEach(async ({ sandbox }) => {
  const { popup } = await sandbox.launch();
  await popup.evaluate(async () => {
    await chrome.storage.local.set({ saul_user_settings: { summaryPdfProcessing: 'local' } });
  });
});

const evidence =
  'A PDF contains readable source evidence about health care innovation and the incentives needed for a viable business model. ';

function summaryId(reader: Page) {
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
    summaryId(reader),
  );
}
async function generations(worker: Worker) {
  return worker.evaluate(() =>
    (
      globalThis as unknown as { digestFixture: { requests: PlanRequest[] } }
    ).digestFixture.requests.filter((r) => r.action === 'generate'),
  );
}

test('PDF viewer capture supports query strings and extensionless documents, with a real packaged worker', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const bytes = pdfFixture([evidence.repeat(4), evidence.repeat(3)]);
  fixtureServer.setDocument('/paper.pdf', { body: bytes });
  fixtureServer.setDocument('/download', { body: bytes });
  const { context, popup, worker } = await sandbox.launch();
  await installDigestProvider(worker);
  const cspErrors: string[] = [];
  context.on('console', (message) => {
    if (/Content Security Policy|fake worker/i.test(message.text())) cspErrors.push(message.text());
  });
  for (const path of ['/paper.pdf?utm_source=chatgpt.com#page=2', '/download?id=49']) {
    const source = await context.newPage();
    await source.goto(fixtureServer.origin + path);
    const reader = await openReader(context, popup, worker, source.url());
    await expect(reader.getByRole('status')).toHaveText('Summary ready');
    const saved = (await inspect(reader)).saved!;
    if (saved.kind === 'pdf-url') throw new Error('Expected captured local text');
    expect(saved.text).toContain('[Page 1]');
    expect(saved.text).toContain('[Page 2]');
    expect(saved.text).toContain('health care innovation');
    expect(saved.coverage).toContain('pages 1–2 of 2');
    expect(saved.truncated).toBe(false);
    await reader.locator('.saul-inspector > summary').click();
    await expect(
      reader.getByRole('region', { name: 'Captured page text', exact: true }).locator('pre'),
    ).toContainText('[Page 2]');
    await reader.screenshot({ path: info.outputPath('pdf-summary.png'), fullPage: true });
    const existing = await generations(worker);
    fixtureServer.setDocument(path.startsWith('/paper') ? '/paper.pdf' : '/download', {
      body: pdfFixture([evidence.repeat(2) + 'New evidence changes the document.']),
    });
    const repeated = await openReader(context, popup, worker, source.url());
    await expect(
      repeated.getByRole('complementary', { name: 'Saved summary reused' }),
    ).toContainText('Text changed');
    expect((await inspect(repeated)).saved).toEqual(saved);
    expect(await generations(worker)).toHaveLength(existing.length);
    fixtureServer.setDocument(path.startsWith('/paper') ? '/paper.pdf' : '/download', {
      body: bytes,
    });
  }
  expect(cspErrors).toEqual([]);
  expect(await generations(worker)).toHaveLength(2);
});

test('PDF source persists across restart; retry uses frozen text after its tab closes', async ({
  sandbox,
  fixtureServer,
}) => {
  fixtureServer.setDocument('/retry.pdf', { body: pdfFixture([evidence.repeat(4)]) });
  const { context, popup, worker } = await sandbox.launch();
  await installDigestProvider(worker, true);
  const source = await context.newPage();
  await source.goto(fixtureServer.origin + '/retry.pdf');
  const reader = await openReader(context, popup, worker, source.url());
  await expect(reader.getByRole('status')).toHaveText('Generating summary…');
  const frozen = (await inspect(reader)).saved!;
  if (frozen.kind === 'pdf-url') throw new Error('Expected captured local text');
  await reader.getByRole('button', { name: 'Stop', exact: true }).click();
  const route = reader.url();
  await source.close();
  const downloads = fixtureServer.documentRequests.length;
  const relaunched = await sandbox.launch();
  await installDigestProvider(relaunched.worker);
  const restored = await relaunched.context.newPage();
  await restored.goto(route);
  expect((await inspect(restored)).saved).toEqual(frozen);
  await restored.getByRole('button', { name: 'Retry unfinished' }).click();
  await expect(restored.getByRole('status')).toHaveText('Summary ready');
  expect(fixtureServer.documentRequests).toHaveLength(downloads);
  const request = (await generations(relaunched.worker))[0]!;
  expect(request.action === 'generate' && JSON.parse(request.userPrompt).text).toBe(frozen.text);
});

test('PDF coverage discloses mixed image-only pages, the character cap and the page cap', async ({
  sandbox,
  fixtureServer,
}) => {
  const cases = [
    {
      path: '/mixed.pdf',
      bytes: pdfFixture([evidence.repeat(3), null, evidence.repeat(2)]),
      coverage: 'Pages with no extractable text: 2.',
      truncated: false,
    },
    {
      path: '/long.pdf',
      bytes: pdfFixture(Array.from({ length: 40 }, () => evidence.repeat(34))),
      coverage: 'last included page may be partial',
      truncated: true,
    },
    {
      path: '/pages.pdf',
      bytes: pdfFixture(Array.from({ length: 201 }, () => evidence)),
      coverage: 'pages 1–200 of 201',
      truncated: true,
    },
  ];
  const { context, popup, worker } = await sandbox.launch();
  await installDigestProvider(worker);
  for (const value of cases) {
    fixtureServer.setDocument(value.path, { body: value.bytes });
    const source = await context.newPage();
    await source.goto(fixtureServer.origin + value.path);
    const reader = await openReader(context, popup, worker, source.url());
    await expect(reader.getByRole('status')).toHaveText('Summary ready');
    const saved = (await inspect(reader)).saved!;
    if (saved.kind === 'pdf-url') throw new Error('Expected captured local text');
    expect(saved.coverage).toContain(value.coverage);
    expect(saved.truncated).toBe(value.truncated);
    expect(saved.text.length).toBeLessThanOrEqual(120_000);
  }
});

test('PDF failures stay visible and never reach generation', async ({ sandbox, fixtureServer }) => {
  const { context, popup, worker } = await sandbox.launch();
  await installDigestProvider(worker);
  const cases = [
    { path: '/scan.pdf', document: { body: pdfFixture([null, null]) }, error: 'need OCR' },
    {
      path: '/password.pdf',
      document: { body: pdfFixture([evidence], 'secret') },
      error: 'password-protected',
    },
    {
      path: '/damaged.pdf',
      document: { body: '%PDF-1.7\nBroken document' },
      error: 'damaged or unsupported',
    },
    { path: '/denied.pdf', document: { body: 'Denied', status: 403 }, error: 'Sign in' },
    {
      path: '/login.pdf',
      document: { body: '<html>Login required</html>', type: 'text/html' },
      error: 'no PDF document',
    },
    {
      path: '/redirect.pdf',
      document: { body: '', status: 302, redirect: '/login.pdf' },
      error: 'no PDF document',
    },
    {
      path: '/oversize.pdf',
      document: { body: '%PDF-1.7', length: 20 * 1024 * 1024 + 1, gated: true },
      error: '20 MiB',
    },
  ];
  for (const value of cases) {
    // Load a normal completed HTTP(S) tab first; change only its subsequent
    // download response to exercise each failure without Chrome's error viewer.
    fixtureServer.setDocument(value.path, {
      body: '<html><title>PDF failure fixture</title></html>',
      type: 'text/html',
    });
    const source = await context.newPage();
    await source.goto(fixtureServer.origin + value.path);
    fixtureServer.setDocument(value.path, value.document);
    const reader = await openReader(context, popup, worker, source.url());
    await expect(reader.getByRole('status')).toHaveText('Could not summarize page');
    await expect(reader.getByText(value.error, { exact: false })).toBeVisible();
    expect((await inspect(reader)).saved).toBeUndefined();
  }
  expect(await generations(worker)).toHaveLength(0);
  await expect.poll(() => fixtureServer.pendingDocumentsCount()).toBe(0);
});

test('Stop aborts a PDF download; navigation or source closure rejects a late capture', async ({
  sandbox,
  fixtureServer,
}) => {
  const { context, popup, worker } = await sandbox.launch();
  await installDigestProvider(worker);
  for (const action of ['stop', 'navigate', 'close'] as const) {
    const path = '/' + action + '.pdf';
    fixtureServer.setDocument(path, {
      body: '<html><title>PDF capture fixture</title></html>',
      type: 'text/html',
    });
    const source = await context.newPage();
    await source.goto(fixtureServer.origin + path);
    fixtureServer.setDocument(path, { body: pdfFixture([evidence.repeat(3)]), gated: true });
    const reader = await openReader(context, popup, worker, source.url());
    await expect.poll(() => fixtureServer.pendingDocumentsCount()).toBe(1);
    if (action === 'stop') {
      await reader.getByRole('button', { name: 'Stop', exact: true }).click();
      await expect(reader.getByRole('status')).toHaveText('Summary stopped');
      await expect.poll(() => fixtureServer.pendingDocumentsCount()).toBe(0);
    } else {
      if (action === 'navigate') await source.goto(fixtureServer.origin + '/article');
      else await source.close();
      fixtureServer.releaseDocuments();
      await expect(reader.getByRole('status')).toHaveText('Could not summarize page');
    }
    expect((await inspect(reader)).saved).toBeUndefined();
  }
  expect(await generations(worker)).toHaveLength(0);
});

test('Stop terminates the PDF parser worker without waiting for its reply', async ({
  sandbox,
  fixtureServer,
}) => {
  const { context, popup, worker } = await sandbox.launch();
  await installDigestProvider(worker);
  fixtureServer.setDocument('/busy.pdf', {
    body: '<html><title>Busy PDF fixture</title></html>',
    type: 'text/html',
  });
  const source = await context.newPage();
  await source.goto(fixtureServer.origin + '/busy.pdf');
  fixtureServer.setDocument('/busy.pdf', { body: pdfFixture([evidence.repeat(4)]) });
  const connection = await context.browser()!.newBrowserCDPSession();
  try {
    const offscreen = (await connection.send('Target.getTargets')).targetInfos.find(
      (target: { url: string }) => target.url.endsWith('/offscreen.html'),
    )!;
    const sessions = new Set<string>();
    const detached = new Set<string>();
    connection.on('Target.attachedToTarget', ({ targetInfo, sessionId }) => {
      if (targetInfo.type === 'worker') sessions.add(sessionId);
    });
    connection.on('Target.detachedFromTarget', ({ sessionId }) => detached.add(sessionId));
    // Pause only new workers related to this disposable offscreen target. The
    // parser cannot reply, so cancellation must terminate rather than await it.
    await connection.send('Target.autoAttachRelated', {
      targetId: offscreen.targetId,
      waitForDebuggerOnStart: true,
      filter: [{ type: 'worker', exclude: false }],
    });
    sessions.clear();
    const reader = await openReader(context, popup, worker, source.url());
    await expect.poll(() => sessions.size).toBe(1);
    await expect(reader.getByRole('status')).toHaveText('Reading page…');
    await reader.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(reader.getByRole('status')).toHaveText('Summary stopped');
    await expect.poll(() => [...sessions].every((session) => detached.has(session))).toBe(true);
    expect((await inspect(reader)).saved).toBeUndefined();
    expect(await generations(worker)).toHaveLength(0);
  } finally {
    await connection.detach();
  }
});

test('the capture deadline aborts a stalled PDF response without generation', async ({
  sandbox,
  fixtureServer,
}) => {
  const { context, popup, worker } = await sandbox.launch();
  await installDigestProvider(worker);
  fixtureServer.setDocument('/timeout.pdf', {
    body: '<html><title>Timeout PDF fixture</title></html>',
    type: 'text/html',
  });
  const source = await context.newPage();
  await source.goto(fixtureServer.origin + '/timeout.pdf');
  fixtureServer.setDocument('/timeout.pdf', { body: pdfFixture([evidence]), gated: true });
  const reader = await openReader(context, popup, worker, source.url());
  await expect.poll(() => fixtureServer.pendingDocumentsCount()).toBe(1);
  await expect(reader.getByRole('status')).toHaveText('Could not summarize page', {
    timeout: 35_000,
  });
  await expect(
    reader.getByText('PDF capture timed out after 30 seconds. Retry explicitly.'),
  ).toBeVisible();
  await expect.poll(() => fixtureServer.pendingDocumentsCount()).toBe(0);
  expect((await inspect(reader)).saved).toBeUndefined();
  expect(await generations(worker)).toHaveLength(0);
});

test('the Herzlinger example yields real PDF text and honest coverage', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const liveUrl = process.env.SAUL_PDF_EXAMPLE_URL;
  test.skip(
    !process.env.SAUL_PDF_EXAMPLE && !liveUrl,
    'Set SAUL_PDF_EXAMPLE to downloaded example bytes, or SAUL_PDF_EXAMPLE_URL for the live public PDF.',
  );
  if (!liveUrl)
    fixtureServer.setDocument('/herzlinger.pdf', {
      body: await readFile(process.env.SAUL_PDF_EXAMPLE!),
    });
  const { context, popup, worker } = await sandbox.launch();
  await installDigestProvider(worker);
  const source = await context.newPage();
  await source.goto(liveUrl || fixtureServer.origin + '/herzlinger.pdf?utm_source=chatgpt.com');
  const reader = await openReader(context, popup, worker, source.url());
  await expect(reader.getByRole('status')).toHaveText('Summary ready', { timeout: 35_000 });
  const saved = (await inspect(reader)).saved!;
  if (saved.kind === 'pdf-url') throw new Error('Expected captured local text');
  expect(saved.text).toContain('Innovating in Health Care');
  expect(saved.text).toContain('business models');
  expect(saved.coverage).toContain('of 49');
  expect(saved.text.length).toBeLessThanOrEqual(120_000);
  const request = (await generations(worker))[0]!;
  expect(request.action === 'generate' && JSON.parse(request.userPrompt).text).toBe(saved.text);
  await reader.screenshot({ path: info.outputPath('herzlinger-summary.png'), fullPage: true });
  await reader.locator('details > summary').filter({ hasText: 'Source coverage' }).click();
  await reader.locator('.saul-inspector > summary').click();
  await expect(
    reader.getByRole('region', { name: 'Captured page text', exact: true }).locator('pre'),
  ).toContainText('Innovating in Health Care');
  await reader.setViewportSize({ width: 420, height: 860 });
  await reader.emulateMedia({ colorScheme: 'dark' });
  expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  await reader.screenshot({
    path: info.outputPath('herzlinger-inspection-dark.png'),
    fullPage: true,
  });
  const batch: DigestBatch = await reader.evaluate(
    async (id) =>
      (await chrome.runtime.sendMessage({ target: 'saul-digest', message: { action: 'get', id } }))
        .result,
    summaryId(reader),
  );
  await info.attach('example-coverage', {
    body: JSON.stringify({
      status: batch.items[0]!.status,
      coverage: saved.coverage,
      characters: saved.text.length,
    }),
    contentType: 'application/json',
  });
});
