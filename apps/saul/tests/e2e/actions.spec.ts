import { test, expect } from './fixtures';
import { configureFixtureProvider } from './driver';
import { installDigestProvider, openDigestReader } from './digest-fixture';
import { actionHelperFixture } from './action-helper-fixture';
import type { ActionModule } from '../../native/action-protocol.mts';
import type { ActionRequest, ActionState } from '../../src/actions/contract';
import type { Page } from '@playwright/test';

test.afterEach(({ fixtureServer }) => {
  fixtureServer.clearHandlers();
});

test('unsubmitted action fields survive navigation and reload without a model call', async ({
  sandbox,
  fixtureServer,
}) => {
  const { popup } = await sandbox.launch();
  await configureFixtureProvider(popup, fixtureServer.origin);
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await popup.getByText('Customize Summarize', { exact: true }).click();
  await popup.getByLabel('Action request', { exact: true }).fill('Keep this unsent request 中文.');
  await popup.getByText('Local module and recovery', { exact: true }).click();
  await popup.getByLabel('Module file path', { exact: true }).fill('/tmp/my-summary.ts');
  await popup.getByRole('button', { name: 'History', exact: true }).click();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await popup.getByText('Customize Summarize', { exact: true }).click();
  await expect(popup.getByLabel('Action request', { exact: true })).toHaveValue(
    'Keep this unsent request 中文.',
  );
  await popup.reload();
  await popup.getByText('Customize Summarize', { exact: true }).click();
  await expect(popup.getByLabel('Action request', { exact: true })).toHaveValue(
    'Keep this unsent request 中文.',
  );
  await popup.getByText('Local module and recovery', { exact: true }).click();
  await expect(popup.getByLabel('Module file path', { exact: true })).toHaveValue(
    '/tmp/my-summary.ts',
  );
  expect(fixtureServer.requests).toHaveLength(0);
  expect((await request(popup, { action: 'status' })).selected).toBeUndefined();
});

const candidate: ActionModule = {
  contractVersion: 1,
  name: 'Evidence summary',
  description: 'Main claim and weakest evidence.',
  language: 'typescript',
  source:
    'export default async function run(ctx) { ctx.progress("Checking evidence…"); const answer = await ctx.generate({instructions:"Explain the main claim and its weakest evidence."}); return "# Main claim\\n\\n" + answer; }',
};
async function request(page: Page, message: ActionRequest): Promise<ActionState> {
  return page.evaluate(async (message) => {
    const reply = await chrome.runtime.sendMessage({ target: 'saul-action', message });
    if (!reply.success) throw new Error(reply.error);
    return reply.result;
  }, message);
}

test('creates and explicitly loads a real local action, renders safely, isolates revision reuse and persists across restart', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const helper = await actionHelperFixture(fixtureServer);
  let module = candidate;
  const calls: Record<string, unknown>[] = [];
  fixtureServer.setHandler('/v1/chat/completions', (req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      const payload = JSON.parse(body);
      calls.push(payload);
      const builder = payload.messages[0].content.includes('Saul action contract 1');
      const text = builder
        ? JSON.stringify(module)
        : 'Useful finding. **Evidence is limited.** <img src=x onerror=alert(1)> [unsafe](javascript:alert(1))';
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(
        `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`,
      );
    });
  });
  try {
    let { worker, context, popup } = await sandbox.launch();
    await helper.install(worker);
    await configureFixtureProvider(popup, fixtureServer.origin);
    await popup.getByRole('button', { name: 'Settings', exact: true }).click();
    await popup.getByText('Customize Summarize', { exact: true }).click();
    await popup
      .getByLabel('Action request', { exact: true })
      .fill('Explain the main claim and its weakest evidence.');
    await popup.getByRole('button', { name: 'Create action', exact: true }).click();
    await expect(popup.getByLabel('Checked candidate')).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(
      helper.messages.some(
        (m) => (m as { request?: { action: string } }).request?.action === 'run',
      ),
    ).toBe(false);
    await popup.getByRole('button', { name: 'Load action', exact: true }).click();
    await expect(
      popup.getByText('Current action: Evidence summary', { exact: true }),
    ).toBeVisible();
    expect(calls).toHaveLength(1);
    const source = await context.newPage();
    await source.goto(fixtureServer.origin + '/article');
    const reader = await openDigestReader(context, popup, worker, source.url());
    await expect(reader.getByRole('heading', { name: 'Main claim', exact: true })).toBeVisible();
    await expect(reader.locator('.action-answer strong')).toHaveText('Evidence is limited.');
    await expect(
      reader.locator('.action-answer img, .action-answer script, .action-answer a'),
    ).toHaveCount(0);
    expect(calls).toHaveLength(2);
    const firstUrl = reader.url();
    await reader.getByText('Inspect input/output', { exact: true }).click();
    await reader.getByText('Saved request and response', { exact: true }).click();
    await expect(
      reader.getByText('Model call 1 · complete response', { exact: true }),
    ).toBeVisible();
    const reused = await openDigestReader(context, popup, worker, source.url());
    await expect(reused.getByLabel('Saved summary reused')).toBeVisible();
    expect(reused.url()).toBe(firstUrl);
    expect(calls).toHaveLength(2);

    module = {
      ...candidate,
      source:
        'export default async ctx => "# Revised answer\\n\\n" + await ctx.generate({instructions:"Make it shorter."});',
    };
    await popup.getByLabel('Action request', { exact: true }).fill('Make it shorter.');
    await popup.getByRole('button', { name: 'Revise action', exact: true }).click();
    await expect
      .poll(async () => (await request(popup, { action: 'status' })).candidate?.source)
      .toBe(module.source);
    expect(calls).toHaveLength(3);
    await popup.getByRole('button', { name: 'Replace action', exact: true }).click();
    await expect
      .poll(async () => (await request(popup, { action: 'status' })).selected?.revision.source)
      .toBe(module.source);
    const changed = await openDigestReader(context, popup, worker, source.url());
    await expect(
      changed.getByRole('heading', { name: 'Revised answer', exact: true }),
    ).toBeVisible();
    expect(changed.url()).not.toBe(firstUrl);
    expect(calls).toHaveLength(4);
    for (const width of [360, 1000])
      for (const colorScheme of ['light', 'dark'] as const) {
        await popup.setViewportSize({ width, height: 800 });
        await popup.emulateMedia({ colorScheme });
        await popup.getByText('Customize Summarize', { exact: true }).scrollIntoViewIfNeeded();
        expect(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await popup.screenshot({
          path: info.outputPath(`action-builder-${width}-${colorScheme}.png`),
          fullPage: true,
        });
        await changed.setViewportSize({ width, height: 800 });
        await changed.emulateMedia({ colorScheme });
        await changed.screenshot({
          path: info.outputPath(`action-answer-${width}-${colorScheme}.png`),
          fullPage: true,
        });
      }
    const savedUrl = changed.url();
    helper.kill();
    ({ worker, context, popup } = await sandbox.launch());
    await helper.install(worker);
    const restored = await context.newPage();
    await restored.goto(savedUrl);
    await expect(
      restored.getByRole('heading', { name: 'Revised answer', exact: true }),
    ).toBeVisible();
    expect(calls).toHaveLength(4);
    expect((await request(popup, { action: 'status' })).selected?.revision.source).toBe(
      module.source,
    );
    expect((await request(popup, { action: 'restore' })).selected?.revision.source).toBe(
      candidate.source,
    );
    expect(calls).toHaveLength(4);
    expect((await request(popup, { action: 'builtin' })).selected).toBeUndefined();
  } finally {
    await helper.close();
  }
});

test('retains incomplete model output on helper loss and Stop; no replay or completed answer', async ({
  sandbox,
  fixtureServer,
}) => {
  const helper = await actionHelperFixture(fixtureServer);
  let requests = 0;
  fixtureServer.setHandler('/v1/chat/completions', (req, res) => {
    req.resume();
    req.on('end', () => {
      requests++;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"incomplete evidence"}}]}\n\n');
    });
  });
  try {
    const { worker, context, popup } = await sandbox.launch();
    await helper.install(worker);
    await configureFixtureProvider(popup, fixtureServer.origin);
    const staged = await request(popup, { action: 'stage', json: JSON.stringify(candidate) });
    await request(popup, {
      action: 'load',
      revision: staged.candidate!.revision,
      presetId: 'preset-current',
    });
    const source = await context.newPage();
    await source.goto(fixtureServer.origin + '/article');
    const reader = await openDigestReader(context, popup, worker, source.url());
    await expect.poll(() => requests).toBe(1);
    helper.kill();
    await expect(reader.getByRole('button', { name: 'Retry unfinished' })).toBeVisible();
    await expect(reader.locator('.action-answer')).toHaveCount(0);
    await reader.getByText('Inspect input/output', { exact: true }).click();
    await reader.getByText('Saved request and response', { exact: true }).click();
    await expect(
      reader.getByText('Model call 1 · incomplete response', { exact: true }),
    ).toBeVisible();
    await expect(reader.locator('.saul-inspection-content')).toContainText('incomplete evidence');
    const url = reader.url();
    await reader.reload();
    await expect(reader.getByRole('button', { name: 'Retry unfinished' })).toBeVisible();
    expect(reader.url()).toBe(url);
    expect(requests).toBe(1);
    await reader.getByRole('button', { name: 'Retry unfinished' }).click();
    await expect.poll(() => requests).toBe(2);
    await reader.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(reader.getByRole('status')).toContainText('Summary stopped');
    expect(requests).toBe(2);
    await expect(reader.locator('.action-answer')).toHaveCount(0);
  } finally {
    await helper.close();
  }
});

test('Run again after restoring the built-in action uses its eligible account rather than a custom-run placeholder', async ({
  sandbox,
  fixtureServer,
}) => {
  const helper = await actionHelperFixture(fixtureServer);
  try {
    const { worker, context, popup } = await sandbox.launch();
    await installDigestProvider(worker);
    await helper.install(worker);
    await configureFixtureProvider(popup, fixtureServer.origin);
    const staged = await request(popup, {
      action: 'stage',
      json: JSON.stringify({ ...candidate, source: 'export default () => "Custom answer";' }),
    });
    await request(popup, {
      action: 'load',
      revision: staged.candidate!.revision,
      presetId: 'preset-current',
    });
    const source = await context.newPage();
    await source.goto(fixtureServer.origin + '/article');
    const reader = await openDigestReader(context, popup, worker, source.url());
    await expect(reader.locator('.action-answer')).toHaveText('Custom answer');
    const customUrl = reader.url();
    await request(popup, { action: 'builtin' });
    await reader.getByRole('button', { name: 'Run again', exact: true }).click();
    await expect(reader.locator('p[lang="en"]').first()).toHaveText(
      'A concise source-backed finding.',
    );
    expect(reader.url()).not.toBe(customUrl);
    await expect(reader.locator('.action-answer')).toHaveCount(0);
  } finally {
    await helper.close();
  }
});
