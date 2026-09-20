import { test, expect } from './fixtures.ts';
import { configureFixtureProvider, createFixtureServer } from './support.ts';
import type { Page } from '@playwright/test';
const history = (page: Page) =>
  page.evaluate(async () => {
    const reply = await chrome.runtime.sendMessage({
      target: 'saul-workspace',
      message: { type: 'DB_GET_HISTORY', payload: {} },
    });
    if (!reply.success) throw new Error(reply.error);
    return reply.result;
  });
async function explain(page: Page, selector = '#concept') {
  await expect(page.locator('saul-root')).toBeAttached();
  await page.locator(selector).click({ clickCount: 3 });
  await page.getByRole('button', { name: 'Explain', exact: true }).click();
}
async function view(page: Page) {
  await page.getByRole('button', { name: 'Page explanations', exact: true }).click();
  await page
    .getByRole('region', { name: 'Page explanations', exact: true })
    .getByRole('button')
    .first()
    .click();
}
test('quiet queue, underline view, refresh and persistent unread explanations', async ({
  sandbox,
  fixtureServer,
}) => {
  let browser = await sandbox.launch();
  await configureFixtureProvider(browser.popup, fixtureServer.origin);
  let page = await browser.context.newPage();
  await page.goto(fixtureServer.origin + '/article');
  const original = await page.locator('#concept').boundingBox();
  await explain(page);
  await expect(page.getByRole('region', { name: 'Saul explanation' })).toHaveCount(0);
  await expect.poll(async () => (await history(browser.popup))[0]?.latest.status).toBe('completed');
  await expect(page.getByText('Explanation ready', { exact: true })).toBeVisible();
  expect((await history(browser.popup))[0].unread).toBe(true);
  expect(await page.locator('#concept').boundingBox()).toEqual(original);
  await page.locator('#concept').click({ position: { x: 30, y: 15 } });
  await expect(page.getByRole('region', { name: 'Saul explanation' })).toBeVisible();
  await expect(page.getByText('Ready · saved on this device', { exact: true })).toBeVisible();
  await expect.poll(async () => (await history(browser.popup))[0]?.unread).toBe(false);
  await page.reload();
  await view(page);
  await expect(page.getByText('Ready · saved on this device', { exact: true })).toBeVisible();
  browser = await sandbox.launch();
  page = await browser.context.newPage();
  await page.goto(fixtureServer.origin + '/article');
  await view(page);
  await expect(page.getByText('Ready · saved on this device', { exact: true })).toBeVisible();
});
test('dismiss, refresh and closing the source do not cancel; actual runner loss requires explicit retry', async ({
  sandbox,
}) => {
  const server = await createFixtureServer('This answer survives leaving the page.', {
    chunkDelayMs: 2000,
  });
  try {
    const { context, popup, worker } = await sandbox.launch();
    await configureFixtureProvider(popup, server.origin);
    let page = await context.newPage();
    await page.goto(server.origin + '/article');
    await explain(page);
    await view(page);
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close explanation' }).click();
    await page.reload();
    await expect.poll(async () => (await history(popup))[0]?.latest.status).toBe('completed');
    await view(page);
    await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
    await expect.poll(async () => (await history(popup))[0]?.latest.status).toBe('running');
    await page.close();
    await expect.poll(async () => (await history(popup))[0]?.latest.status).toBe('completed');
    page = await context.newPage();
    await page.goto(server.origin + '/article');
    await view(page);
    await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
    await expect
      .poll(async () => (await history(popup))[0]?.latest.responseRaw.length)
      .toBeGreaterThan(0);
    await worker.evaluate(() => chrome.offscreen.closeDocument());
    await expect.poll(async () => (await history(popup))[0]?.latest.status).toBe('interrupted');
    const row = (await history(popup))[0];
    expect(row.completed.responseRaw).toBe('This answer survives leaving the page.');
    expect(row.latest.responseRaw).toBeTruthy();
    await page.reload();
    await view(page);
    await expect(page.getByRole('button', { name: 'Retry explanation' })).toBeVisible();
  } finally {
    await server.close();
  }
});

test('queue limits, frozen configuration, repeated Explain, stop, and deletion during generation', async ({
  sandbox,
}) => {
  const server = await createFixtureServer('A retained answer.', { chunkDelayMs: 2500 });
  try {
    const { popup, context } = await sandbox.launch();
    await configureFixtureProvider(popup, server.origin);
    const page = await context.newPage();
    await page.goto(server.origin + '/article');
    await explain(page);
    await expect.poll(() => server.requests.length).toBe(1);
    await explain(page);
    await expect(page.getByRole('region', { name: 'Saul explanation' })).toBeVisible();
    expect(server.requests).toHaveLength(1);
    await page.getByRole('button', { name: 'Close explanation' }).click();
    await explain(page, '#second');
    await explain(page, '#third');
    await expect.poll(async () => (await history(popup)).length).toBe(3);
    expect(server.requests).toHaveLength(2);
    expect((await history(popup)).filter((p: any) => p.latest.status === 'queued')).toHaveLength(1);
    await popup.evaluate(async () => {
      const data = await chrome.storage.local.get('saul_user_settings');
      (data.saul_user_settings as { openaiCompatible: { model: string } }).openaiCompatible.model =
        'later-model';
      await chrome.storage.local.set(data);
    });
    await expect.poll(() => server.requests.length).toBe(3);
    expect(JSON.parse(server.requests[2]!.body).model).toBe('test-model');
    // Deleting the last, running passage prevents its eventual terminal event recreating it.
    const row = (await history(popup)).find((p: any) => p.selectedText === 'Learning rate');
    await popup.evaluate(async (id) => {
      await chrome.runtime.sendMessage({
        target: 'saul-workspace',
        message: { type: 'DB_DELETE_SELECTION', payload: { selectionId: id } },
      });
    }, row.selectionId);
    await expect.poll(async () => (await history(popup)).length).toBe(2);
    await expect
      .poll(async () => (await history(popup)).every((p: any) => p.latest.status === 'completed'))
      .toBe(true);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Page explanations' })).toContainText('Saul · 2');
  } finally {
    await server.close();
  }
});

test('browser loss interrupts both running and unsent queued jobs without automatic replay', async ({
  sandbox,
}) => {
  const server = await createFixtureServer('Partial stream to recover.', { chunkDelayMs: 10000 });
  try {
    let browser = await sandbox.launch();
    await configureFixtureProvider(browser.popup, server.origin);
    const page = await browser.context.newPage();
    await page.goto(server.origin + '/article');
    await explain(page);
    await explain(page, '#second');
    await explain(page, '#third');
    await expect.poll(() => server.requests.length).toBe(2);
    browser = await sandbox.launch();
    await expect
      .poll(async () => (await history(browser.popup)).map((p: any) => p.latest.status))
      .toEqual(['interrupted', 'interrupted', 'interrupted']);
    expect(server.requests).toHaveLength(2);
    const rows = await history(browser.popup);
    expect(rows.filter((p: any) => p.latest.responseRaw)).toHaveLength(2);
    expect(rows.every((p: any) => !p.completed)).toBe(true);
  } finally {
    await server.close();
  }
});

test('service-worker restart reconnects to the same runner and does not replay the request', async ({
  sandbox,
}) => {
  const server = await createFixtureServer('Completed across worker restart.', {
    chunkDelayMs: 4000,
  });
  try {
    const { popup, context, worker } = await sandbox.launch();
    await configureFixtureProvider(popup, server.origin);
    const cdp = await context.newCDPSession(popup);
    const versions: { versionId: string; scriptURL: string; runningStatus: string }[] = [];
    cdp.on('ServiceWorker.workerVersionUpdated', (event) => versions.push(...event.versions));
    await cdp.send('ServiceWorker.enable');
    const page = await context.newPage();
    await page.goto(server.origin + '/article');
    await explain(page);
    await expect.poll(() => server.requests.length).toBe(1);
    await expect
      .poll(
        () =>
          versions.find((v) => v.scriptURL === worker.url() && v.runningStatus === 'running')
            ?.versionId,
      )
      .toBeTruthy();
    const version = versions.find(
      (v) => v.scriptURL === worker.url() && v.runningStatus === 'running',
    )!;
    await cdp.send('ServiceWorker.stopWorker', { versionId: version.versionId });
    await expect.poll(async () => (await history(popup))[0]?.latest.status).toBe('completed');
    expect(server.requests).toHaveLength(1);
    await view(page);
    await expect(page.getByText('Completed across worker restart.', { exact: true })).toBeVisible();
  } finally {
    await server.close();
  }
});

for (const ending of ['eof', 'length'] as const)
  test(`${ending} keeps an incomplete regeneration and its earlier successful answer`, async ({
    sandbox,
  }) => {
    const server = await createFixtureServer('A useful explanation.');
    try {
      const { popup, context } = await sandbox.launch();
      await configureFixtureProvider(popup, server.origin);
      const page = await context.newPage();
      await page.goto(server.origin + '/article');
      await explain(page);
      await expect.poll(async () => (await history(popup))[0]?.latest.status).toBe('completed');
      await view(page);
      server.setEnding(ending);
      await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
      await expect.poll(async () => (await history(popup))[0]?.latest.status).toBe('interrupted');
      const row = (await history(popup))[0];
      expect(row.latest.responseRaw).toBe('A useful explanation.');
      expect(row.completed.responseRaw).toBe('A useful explanation.');
      expect(row.unread).toBe(false);
      await expect(page.getByRole('button', { name: 'Retry explanation' })).toBeVisible();
    } finally {
      await server.close();
    }
  });

test('content capabilities reject global history, direct runner access and another page passage', async ({
  sandbox,
  fixtureServer,
}) => {
  const { popup, context, worker } = await sandbox.launch();
  await configureFixtureProvider(popup, fixtureServer.origin);
  const page = await context.newPage();
  await page.goto(fixtureServer.origin + '/article');
  await explain(page);
  await expect.poll(async () => (await history(popup))[0]?.latest.status).toBe('completed');
  const row = (await history(popup))[0];
  await page.goto(fixtureServer.origin + '/anchors');
  await expect(page.locator('saul-root')).toBeAttached();
  const cdp = await context.newCDPSession(page),
    contexts: { id: number }[] = [];
  cdp.on('Runtime.executionContextCreated', (event) => contexts.push(event.context));
  await cdp.send('Runtime.enable');
  let contentContext: number | undefined;
  for (const candidate of contexts) {
    const value = await cdp.send('Runtime.evaluate', {
      contextId: candidate.id,
      expression: 'typeof chrome !== "undefined" && chrome.runtime?.id',
      returnByValue: true,
    });
    if (value.result.value === new URL(worker.url()).host) contentContext = candidate.id;
  }
  expect(contentContext).toBeDefined();
  const message = async (data: unknown) => {
    const evaluated = await cdp.send('Runtime.evaluate', {
      contextId: contentContext,
      expression: `chrome.runtime.sendMessage(${JSON.stringify(data)})`,
      awaitPromise: true,
      returnByValue: true,
    });
    return evaluated.result.value;
  };
  expect(
    (await message({ target: 'saul-workspace', message: { type: 'DB_GET_HISTORY', payload: {} } }))
      .success,
  ).toBe(false);
  expect(
    (
      await message({
        target: 'saul-offscreen',
        operation: 'db',
        message: { type: 'DB_CLEAR_HISTORY' },
      })
    ).success,
  ).toBe(false);
  expect(
    (
      await message({
        target: 'saul-reading',
        message: { action: 'view', selectionId: row.selectionId, runId: row.latest.id },
      })
    ).success,
  ).toBe(false);
  expect(
    (await message({ target: 'saul-reading', message: { action: 'list' } })).result.passages,
  ).toEqual([]);
  expect((await history(popup)).length).toBe(1);
});

test('submission and completion are idempotent; deletion makes late writes inert', async ({
  sandbox,
  fixtureServer,
}) => {
  const { worker, popup } = await sandbox.launch();
  await history(popup);
  const results = await worker.evaluate(async (origin) => {
    const db = async (type: string, payload?: unknown) => {
      const result = await chrome.runtime.sendMessage({
        target: 'saul-offscreen',
        operation: 'db',
        message: { type, payload },
      });
      if (!result.success) throw new Error(result.error);
      return result.result;
    };
    const snapshot = {
      id: 'idempotent',
      text: 'term',
      page: { url: origin + '/article', title: 'Fixture' },
      anchor: { exact: 'term', prefix: 'before ', suffix: ' after', textStart: 7, textEnd: 11 },
      viewport: { x: 0, y: 0, width: 0, height: 0, scrollX: 0, scrollY: 0 },
      capturedAt: 1,
    };
    const input = {
      provider: 'openai-compatible',
      remote: { baseUrl: origin + '/v1', model: 'test-model', temperature: 0.3 },
      local: { temperature: 0.3, topK: 3 },
      context: { selection: 'term', pageTitle: '', pageUrl: '' },
      systemPrompt: 'test',
      userPrompt: 'test',
    };
    const submission = { snapshot, input, submissionId: 'request-a', regenerate: false };
    const replies = await Promise.all([db('DB_SUBMIT', submission), db('DB_SUBMIT', submission)]);
    const runId = replies.find((r) => r.run).run.id;
    await db('DB_CLAIM', { runId });
    await db('DB_SAVING', { runId });
    const finish = { runId, raw: 'First committed answer', status: 'completed', latencyMs: 1 };
    const commits = await Promise.all([
      db('DB_FINISH', finish),
      db('DB_FINISH', { ...finish, raw: 'Should not replace' }),
    ]);
    // A regenerate request reused while another run is active must stay reused later, too.
    const attempt = await db('DB_SUBMIT', {
      ...submission,
      submissionId: 'request-b',
      regenerate: true,
    });
    const reused = await db('DB_SUBMIT', {
      ...submission,
      submissionId: 'request-c',
      regenerate: true,
    });
    await db('DB_FINISH', { runId: attempt.run.id, raw: '', status: 'cancelled', latencyMs: 0 });
    const again = await db('DB_SUBMIT', {
      ...submission,
      submissionId: 'request-c',
      regenerate: true,
    });
    const runs = await db('DB_RUNS', { selectionId: snapshot.id });
    await db('DB_DELETE_SELECTION', { selectionId: snapshot.id });
    const late = await db('DB_FINISH', finish);
    return {
      created: replies.filter((r) => r.run).length,
      commits,
      reused: !reused.run && !again.run,
      runs,
      late,
      history: await db('DB_GET_HISTORY', {}),
    };
  }, fixtureServer.origin);
  expect(results.created).toBe(1);
  expect(results.commits).toEqual([true, false]);
  expect(results.reused).toBe(true);
  expect(results.runs).toHaveLength(2);
  expect(results.runs[1].responseRaw).toBe('First committed answer');
  expect(results.late).toBe(false);
  expect(results.history).toEqual([]);
});

test('an old in-flight page refresh cannot strand the subscription after SPA navigation', async ({
  sandbox,
}) => {
  const server = await createFixtureServer('Ready on the new route.', { chunkDelayMs: 1600 });
  try {
    const { popup, context, worker } = await sandbox.launch();
    await configureFixtureProvider(popup, server.origin);
    const page = await context.newPage();
    await page.goto(server.origin + '/article');
    await explain(page);
    await expect(page.getByText('Explanation ready', { exact: true })).toBeVisible();
    const row = (await history(popup))[0];
    // Hold one background-to-offscreen page response across a same-document navigation.
    await worker.evaluate(() => {
      const runtime = chrome.runtime;
      const original = runtime.sendMessage.bind(runtime) as (message: unknown) => Promise<unknown>;
      const state = globalThis as typeof globalThis & {
        releaseReadingResponse?: () => void;
        readingResponseHeld?: boolean;
      };
      runtime.sendMessage = (async (message: { target?: string; message?: { type?: string } }) => {
        const reply = await original(message);
        if (message.target === 'saul-offscreen' && message.message?.type === 'DB_PAGE') {
          runtime.sendMessage = original as typeof runtime.sendMessage;
          state.readingResponseHeld = true;
          await new Promise<void>((resolve) => {
            state.releaseReadingResponse = resolve;
          });
        }
        return reply;
      }) as typeof runtime.sendMessage;
    });
    await popup.evaluate(async (selectionId) => {
      await chrome.runtime.sendMessage({
        target: 'saul-workspace',
        message: { type: 'DB_SET_BOOKMARK', payload: { selectionId, bookmarked: true } },
      });
    }, row.selectionId);
    await expect
      .poll(() =>
        worker.evaluate(
          () =>
            (globalThis as typeof globalThis & { readingResponseHeld?: boolean })
              .readingResponseHeld,
        ),
      )
      .toBe(true);
    await page.evaluate(() => window.history.pushState({}, '', '#second-route'));
    await worker.evaluate(() =>
      (
        globalThis as typeof globalThis & { releaseReadingResponse?: () => void }
      ).releaseReadingResponse?.(),
    );
    await expect(page.getByRole('button', { name: 'Page explanations', exact: true })).toHaveCount(
      0,
    );
    await explain(page, '#third');
    await expect.poll(() => server.requests.length).toBe(2);
    await expect(page.getByText('Explanation ready', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Page explanations', exact: true }),
    ).toContainText('Saul · 1');
    const rows = await history(popup);
    expect(rows).toHaveLength(2);
    expect(
      rows.find((p: { selectedText: string }) => p.selectedText === 'Learning rate').pageUrl,
    ).toBe(server.origin + '/article#second-route');
    expect(server.requests).toHaveLength(2);
  } finally {
    await server.close();
  }
});
