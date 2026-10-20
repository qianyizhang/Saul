import { test, expect } from './fixtures.ts';
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import type { DigestBatch } from '../../src/digest/types';

// Explicit opt-in: uses the installed helper's saved sign-in and real plan quota.
// Only the disposable profile registers the host; no personal profile is modified.
test('live installed helper summarizes three public tabs and exports a durable digest', async ({
  sandbox,
}, info) => {
  test.skip(!process.env.SAUL_LIVE_CHATGPT_HOST, 'Requires explicit live ChatGPT host opt-in.');
  test.setTimeout(240_000);
  const { worker, context, popup: chooser } = await sandbox.launch();
  let popup = chooser;
  const extensionId = new URL(worker.url()).host;
  const hostDir = path.join(sandbox.profile, 'NativeMessagingHosts');
  await mkdir(hostDir, { recursive: true });
  await writeFile(
    path.join(hostDir, 'com.saul.chatgpt.json'),
    JSON.stringify({
      name: 'com.saul.chatgpt',
      description: 'Installed Saul helper for explicit live verification',
      path: process.env.SAUL_LIVE_CHATGPT_HOST,
      type: 'stdio',
      allowed_origins: [`chrome-extension://${extensionId}/`],
    }),
    { mode: 0o600 },
  );
  const urls = [
    'https://terrytao.wordpress.com/2026/09/24/were-gonna-need-a-lot-more-mathematicians/',
    'https://lucumr.pocoo.org/2026/10/6/codemode/',
    'https://kylekukshtel.com/ai-harness-engineering-game-development-claude-code',
  ];
  const windowId = await worker.evaluate(
    async (urls) => (await chrome.windows.create({ url: urls, focused: false }))!.id!,
    urls,
  );
  await expect
    .poll(
      () =>
        worker.evaluate(
          async (windowId) =>
            (await chrome.tabs.query({ windowId })).filter(
              (t) => t.status === 'complete' && t.url?.startsWith('https:'),
            ).length,
          windowId,
        ),
      { timeout: 60_000 },
    )
    .toBe(3);
  for (const url of urls) {
    const page = context.pages().find((p) => p.url() === url);
    expect(page, 'Source loaded: ' + url).toBeTruthy();
    expect((await page!.locator('body').innerText()).length).toBeGreaterThan(500);
  }
  const titles = await popup.evaluate(
    async ({ windowId, urls }) => {
      const current = await chrome.tabs.getCurrent();
      await chrome.tabs.move(current!.id!, { windowId, index: -1 });
      return (await chrome.tabs.query({ windowId }))
        .filter((t) => urls.includes(t.url!))
        .map((t) => t.title!);
    },
    { windowId, urls },
  );
  await popup.getByRole('button', { name: 'Window', exact: true }).click();
  for (const title of titles)
    await popup.getByRole('checkbox', { name: 'Select ' + title, exact: true }).check();
  const opening = context.waitForEvent('page');
  await popup.getByRole('button', { name: 'Summarize', exact: true }).click();
  popup = await opening;
  await expect(popup.getByRole('button', { name: 'Stop', exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await popup.screenshot({ path: info.outputPath('live-progress.png'), fullPage: true });
  await expect(popup.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0, {
    timeout: 170_000,
  });
  const batch = await popup.evaluate(async () => {
    const list = await chrome.runtime.sendMessage({
      target: 'saul-digest',
      message: { action: 'list' },
    });
    const reply = await chrome.runtime.sendMessage({
      target: 'saul-digest',
      message: { action: 'get', id: list.result[0].id },
    });
    if (!reply.success) throw new Error(reply.error);
    return reply.result as DigestBatch;
  });
  // Retain failures too, so a live failure cannot be mistaken for a successful batch.
  await writeFile(
    info.outputPath('live-result.json'),
    JSON.stringify({ ...batch, accountId: '[saved local account]' }, null, 2),
  );
  expect(batch.items.map((i) => ({ url: i.url, status: i.status, error: i.error }))).toEqual(
    urls.map((url) => ({ url, status: 'completed', error: undefined })),
  );
  expect(batch.model).toBe('gpt-6-luna');
  expect(batch.effort).toBe('medium');
  await popup.screenshot({ path: info.outputPath('live-completed.png'), fullPage: true });
  const downloading = popup.waitForEvent('download');
  await popup.getByRole('button', { name: 'Export HTML' }).click();
  const download = await downloading;
  const downloaded = (await download.path())!;
  await copyFile(downloaded, info.outputPath('live-digest.html'));
  const html = await readFile(downloaded, 'utf8');
  for (const item of batch.items) {
    expect(html).toContain(item.url);
    expect(item.summary).toBeTruthy();
  }
  const exportPage = await context.newPage();
  await exportPage.setContent(html);
  expect(await exportPage.locator('article').count()).toBe(3);
  expect(
    await exportPage
      .locator('article .lead')
      .evaluateAll((nodes) =>
        nodes.every(
          (n) =>
            n.children[0]?.getAttribute('lang') === 'en' &&
            n.children[1]?.getAttribute('lang') === 'zh-Hans',
        ),
      ),
  ).toBe(true);
  await exportPage.screenshot({ path: info.outputPath('live-export.png'), fullPage: true });
  await popup.reload();
  await expect(popup.getByRole('status')).toContainText('3 of 3 summarized');
  console.log(
    'Live verification: 3/3 completed through installed native messaging; export and reopen passed.',
  );
});
