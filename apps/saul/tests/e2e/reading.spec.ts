import { readingMore, sendDb } from './driver.ts';
import { runDatabaseFixture } from './database-harness.ts';
import type { DbOperations, DbRequest, Submission } from '../../shared/protocol/history-types.ts';
import { test, expect } from './fixtures.ts';
import { configureFixtureProvider, createFixtureServer } from './support.ts';
import {
  explainSelection as explain,
  queueSelection,
  getFirstHistory,
  getHistory as history,
  openFirstPageExplanation as view,
} from './driver.ts';

test('pointer opens once; closing before completion stays closed and keyboard reuse stays quiet', async ({
  sandbox,
}) => {
  const server = await createFixtureServer('An explicitly opened answer.', { gated: true });
  try {
    const { popup, context } = await sandbox.launch();
    await configureFixtureProvider(popup, server.origin);
    const page = await context.newPage();
    await page.goto(server.origin + '/article');
    await explain(page);
    const card = page.getByRole('region', { name: 'Saul explanation' });
    await expect(card).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close explanation', exact: true }).click();
    server.releaseAll();
    await expect.poll(async () => (await getFirstHistory(popup)).latest.status).toBe('completed');
    await expect(card).toHaveCount(0);
    await queueSelection(page);
    await expect(page.getByText('Request available', { exact: true })).toBeVisible();
    await expect(card).toHaveCount(0);
    expect(server.requests).toHaveLength(1);
    await explain(page);
    await expect(card).toBeVisible();
    expect(server.requests).toHaveLength(1);
  } finally {
    await server.close();
  }
});
test('quiet queue, underline view, refresh and persistent unread explanations', async ({
  sandbox,
  fixtureServer,
}) => {
  let browser = await sandbox.launch();
  await configureFixtureProvider(browser.popup, fixtureServer.origin);
  let page = await browser.context.newPage();
  await page.goto(fixtureServer.origin + '/article');
  const original = await page.locator('#concept').boundingBox();
  await queueSelection(page);
  await expect(page.getByRole('region', { name: 'Saul explanation' })).toHaveCount(0);
  await expect.poll(async () => (await history(browser.popup))[0]?.latest.status).toBe('completed');
  await expect(page.getByText('Explanation ready', { exact: true })).toBeVisible();
  expect((await getFirstHistory(browser.popup)).unread).toBe(true);
  expect(await page.locator('#concept').boundingBox()).toEqual(original);
  await page.locator('#concept').click({ position: { x: 30, y: 15 } });
  await expect(page.getByRole('region', { name: 'Saul explanation' })).toBeVisible();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect.poll(async () => (await history(browser.popup))[0]?.unread).toBe(false);
  await page.reload();
  await view(page);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  browser = await sandbox.launch();
  page = await browser.context.newPage();
  await page.goto(fixtureServer.origin + '/article');
  await view(page);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
});
test('reopening a closed source from History delivers its saved explanation after startup', async ({
  sandbox,
  fixtureServer,
}) => {
  const { context, popup } = await sandbox.launch();
  const initialRequests = fixtureServer.requests.length;
  await configureFixtureProvider(popup, fixtureServer.origin);
  const source = await context.newPage();
  await source.goto(fixtureServer.origin + '/article');
  await explain(source);
  await expect(source.getByText('Saved', { exact: true })).toBeVisible();
  await source.close();

  await popup.getByRole('button', { name: 'History', exact: true }).click();
  const opened = context.waitForEvent('page');
  await popup.getByTitle('View source and explanation').click();
  const page = await opened;
  await expect(page).toHaveURL(fixtureServer.origin + '/article');
  await expect(page.getByRole('region', { name: 'Saul explanation' })).toBeVisible();
  expect(fixtureServer.requests).toHaveLength(initialRequests + 1);
});

test('dismiss, refresh and closing the source do not cancel; actual runner loss requires explicit retry', async ({
  sandbox,
}) => {
  const server = await createFixtureServer('This answer survives leaving the page.', {
    gated: true,
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
    server.releaseAll();
    await expect.poll(async () => (await history(popup))[0]?.latest.status).toBe('completed');
    await view(page);
    await readingMore(page);
    await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
    await expect.poll(async () => (await history(popup))[0]?.latest.status).toBe('running');
    await page.close();
    server.releaseAll();
    await expect.poll(async () => (await history(popup))[0]?.latest.status).toBe('completed');
    page = await context.newPage();
    await page.goto(server.origin + '/article');
    await view(page);
    const previousAttempt = (await getFirstHistory(popup)).latest.id;
    await readingMore(page);
    await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
    await expect.poll(async () => (await history(popup))[0]?.latest.id).not.toBe(previousAttempt);
    await expect
      .poll(async () => (await history(popup))[0]?.latest.responseRaw.length)
      .toBeGreaterThan(0);
    await worker.evaluate(() => chrome.offscreen.closeDocument());
    await expect.poll(async () => (await history(popup))[0]?.latest.status).toBe('interrupted');
    const row = await getFirstHistory(popup);
    expect(row.completed?.responseRaw).toBe('This answer survives leaving the page.');
    expect(row.latest.responseRaw).toBeTruthy();
    await page.reload();
    await view(page);
    await expect(page.getByRole('button', { name: 'Retry explanation' })).toBeVisible();
  } finally {
    await server.close();
  }
});

test('a failed terminal write preserves the saved answer and Retry starts one new attempt', async ({
  sandbox,
}) => {
  const server = await createFixtureServer('An answer kept across failed writes.');
  try {
    const { popup, context } = await sandbox.launch();
    await configureFixtureProvider(popup, server.origin);
    const page = await context.newPage();
    await page.goto(server.origin + '/article');
    await explain(page);
    await expect.poll(async () => (await history(popup))[0]?.latest.status).toBe('completed');
    const saved = await getFirstHistory(popup);
    sandbox.rejectHistoryWriteOnce(
      ({ type, payload }) =>
        type === 'DB_FINISH' && (payload as { status: string }).status === 'completed',
    );
    await readingMore(page);
    await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'Saul explanation' }).getByRole('alert'),
    ).toContainText('Could not save');
    await expect.poll(async () => (await history(popup))[0]?.latest.status).toBe('failed');
    expect((await getFirstHistory(popup)).completed?.id).toBe(saved.latest.id);
    expect(server.requests).toHaveLength(2);
    await page.getByRole('button', { name: 'Retry explanation', exact: true }).click();
    await expect.poll(async () => (await history(popup))[0]?.latest.status).toBe('completed');
    expect((await getFirstHistory(popup)).latest.id).not.toBe(saved.latest.id);
    expect(server.requests).toHaveLength(3);
  } finally {
    await server.close();
  }
});

test('queue limits, frozen configuration, repeated Explain, stop, and deletion during generation', async ({
  sandbox,
}) => {
  const server = await createFixtureServer('A retained answer.', { gated: true });
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
    expect(
      (await history(popup)).filter((passage) => passage.latest.status === 'queued'),
    ).toHaveLength(1);
    await popup.evaluate(async () => {
      const data = await chrome.storage.local.get('saul_user_settings');
      const settings = data.saul_user_settings as {
        configuration: { presets: { model: string }[] };
      };
      settings.configuration.presets[0]!.model = 'later-model';
      await chrome.storage.local.set(data);
    });
    server.releaseAll();
    await expect.poll(() => server.requests.length).toBe(3);
    expect(JSON.parse(server.requests[2]!.body).model).toBe('test-model');
    // Deleting the last, running passage prevents its eventual terminal event recreating it.
    await popup.getByRole('button', { name: 'History', exact: true }).click();
    const row = popup.locator('.history-entry').filter({ hasText: 'Learning rate' });
    await row.locator('.history-title').click();
    await row.locator('.history-more > summary').click();
    await row.getByRole('button', { name: 'Stop and delete', exact: true }).last().click();
    await expect(row).toHaveCount(0);
    server.setGated(false);
    server.releaseAll();
    await expect.poll(async () => (await history(popup)).length).toBe(2);
    await expect
      .poll(async () =>
        (await history(popup)).every((passage) => passage.latest.status === 'completed'),
      )
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
  const server = await createFixtureServer('Partial stream to recover.', { gated: true });
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
      .poll(async () => (await history(browser.popup)).map((passage) => passage.latest.status))
      .toEqual(['interrupted', 'interrupted', 'interrupted']);
    expect(server.requests).toHaveLength(2);
    const rows = await history(browser.popup);
    expect(rows.filter((passage) => passage.latest.responseRaw)).toHaveLength(2);
    expect(rows.every((passage) => !passage.completed)).toBe(true);
  } finally {
    await server.close();
  }
});

test('service-worker restart reconnects to the same runner and does not replay the request', async ({
  sandbox,
}) => {
  const server = await createFixtureServer('Completed across worker restart.', {
    gated: true,
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
    server.setGated(false);
    server.releaseAll();
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
      await readingMore(page);
      await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
      await expect.poll(async () => (await history(popup))[0]?.latest.status).toBe('interrupted');
      const row = await getFirstHistory(popup);
      expect(row.latest.responseRaw).toBe('A useful explanation.');
      expect(row.completed?.responseRaw).toBe('A useful explanation.');
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
  const row = await getFirstHistory(popup);
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

test.describe('reading persistence', () => {
  test.use({ databaseFixtures: true });

  test('submission and completion are idempotent; deletion makes late writes inert', async ({
    sandbox,
    fixtureServer,
  }) => {
    const { worker, popup } = await sandbox.launch();
    await history(popup);
    const origin = fixtureServer.origin;
    const snapshot: Submission['snapshot'] = {
      id: 'idempotent',
      text: 'term',
      page: { url: origin + '/article', title: 'Fixture' },
      anchor: { exact: 'term', prefix: 'before ', suffix: ' after', textStart: 7, textEnd: 11 },
      viewport: { x: 0, y: 0, width: 0, height: 0, scrollX: 0, scrollY: 0 },
      capturedAt: 1,
    };
    const input: Submission['input'] = {
      provider: 'openai-compatible',
      remote: { baseUrl: origin + '/v1', model: 'test-model', temperature: 0.3 },
      local: { temperature: 0.3, topK: 3 },
      context: { selection: 'term', pageTitle: '', pageUrl: '' },
      systemPrompt: 'test',
      userPrompt: 'test',
    };
    const submission: Submission = {
      snapshot,
      input,
      submissionId: 'request-a',
      regenerate: false,
    };
    const request = { type: 'DB_SUBMIT', payload: submission } as const;
    await expect(
      worker.evaluate(
        (message) =>
          chrome.runtime.sendMessage({ target: 'saul-offscreen', operation: 'db', message }),
        request,
      ),
    ).resolves.toMatchObject({ success: false, error: 'Unknown workspace storage operation' });

    // Exercise private persistence transitions through the isolated native SQLite fixture.
    const db = <M extends DbRequest>(message: M) =>
      runDatabaseFixture<DbOperations[M['type']]['result']>(popup, { action: 'db', message });
    const replies = await Promise.all([db(request), db(request)]);
    const created = replies.filter((result) => result.run);
    expect(created).toHaveLength(1);
    const runId = created[0]!.run!.id;
    await db({ type: 'DB_CLAIM', payload: { runId } });
    await db({ type: 'DB_SAVING', payload: { runId } });
    const finish = {
      runId,
      raw: 'First committed answer',
      status: 'completed',
      latencyMs: 1,
    } as const;
    expect(await db({ type: 'DB_FINISH', payload: finish })).toBe(true);
    expect(await db({ type: 'DB_FINISH', payload: { ...finish, raw: 'Should not replace' } })).toBe(
      false,
    );

    const attempt = await db({
      type: 'DB_SUBMIT',
      payload: { ...submission, submissionId: 'request-b', regenerate: true },
    });
    // A regenerate request reused while another run is active must stay reused later, too.
    const reusing = {
      type: 'DB_SUBMIT',
      payload: { ...submission, submissionId: 'request-c', regenerate: true },
    } as const;
    expect((await db(reusing)).run).toBeUndefined();
    await db({
      type: 'DB_FINISH',
      payload: { runId: attempt.run!.id, raw: '', status: 'cancelled', latencyMs: 0 },
    });
    expect((await db(reusing)).run).toBeUndefined();

    const selection = { selectionId: snapshot.id };
    const runs = await sendDb(popup, { type: 'DB_RUNS', payload: selection });
    expect(runs).toHaveLength(2);
    expect(runs[1]?.responseRaw).toBe('First committed answer');
    await sendDb(popup, { type: 'DB_DELETE_SELECTION', payload: selection });
    expect(await db({ type: 'DB_FINISH', payload: finish })).toBe(false);
    expect(await history(popup)).toEqual([]);
  });
});

test('an old in-flight page refresh cannot strand the subscription after SPA navigation', async ({
  sandbox,
}) => {
  const server = await createFixtureServer('Ready on the new route.');
  try {
    const { popup, context, worker } = await sandbox.launch();
    await configureFixtureProvider(popup, server.origin);
    const page = await context.newPage();
    await page.goto(server.origin + '/article');
    await queueSelection(page);
    await expect(page.getByText('Explanation ready', { exact: true })).toBeVisible();
    const row = await getFirstHistory(popup);
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
    await queueSelection(page, '#third');
    await expect.poll(() => server.requests.length).toBe(2);
    await expect(page.getByText('Explanation ready', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Page explanations', exact: true }),
    ).toContainText('Saul · 1');
    const rows = await history(popup);
    expect(rows).toHaveLength(2);
    expect(rows.find((passage) => passage.selectedText === 'Learning rate')?.pageUrl).toBe(
      server.origin + '/article#second-route',
    );
    expect(server.requests).toHaveLength(2);
  } finally {
    await server.close();
  }
});
