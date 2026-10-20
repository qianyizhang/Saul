import { test, expect } from './fixtures.ts';
import type { PlanRequest, PlanEvent } from '../../native/plan-protocol.mjs';
import type { DigestBatch } from '../../src/digest/types';
import { readFile } from 'node:fs/promises';

test('window digest survives popup closure, exports ordered pairs and retries captured sources', async ({
  sandbox,
  fixtureServer,
}, testInfo) => {
  const { worker, context, popup } = await sandbox.launch();
  await worker.evaluate(() => {
    const state = { requests: [] as PlanRequest[], hold: true, finish: () => {} };
    Object.assign(globalThis, { digestFixture: state });
    chrome.runtime.connectNative = (() => {
      const listeners: ((m: { id: string; event: PlanEvent }) => void)[] = [];
      return {
        onMessage: {
          addListener: (fn: (m: { id: string; event: PlanEvent }) => void) => listeners.push(fn),
        },
        onDisconnect: { addListener: () => {} },
        disconnect: () => {},
        postMessage: (message: { id: string; request: PlanRequest; cancel?: boolean }) => {
          if (message.cancel) return;
          const emit = (event: PlanEvent) =>
            listeners.forEach((fn) => fn({ id: message.id, event }));
          state.requests.push(message.request);
          queueMicrotask(() => {
            switch (message.request.action) {
              case 'accounts':
                emit({
                  type: 'result',
                  accounts: [
                    { id: 'fixture', label: 'Fixture', signedIn: true, planEnabled: true },
                  ],
                });
                break;
              case 'models':
                emit({
                  type: 'result',
                  models: [
                    {
                      slug: 'gpt-6-luna',
                      display_name: 'Luna',
                      supportedReasoningEfforts: [{ effort: 'medium', description: 'Medium' }],
                      defaultReasoningEffort: 'medium',
                      isDefault: true,
                    },
                  ],
                });
                break;
              case 'generate': {
                const p = { en: 'A concise source-backed finding.', zh: '简明且基于来源的结论。' };
                state.finish = () => {
                  emit({
                    type: 'delta',
                    text: JSON.stringify({
                      lead: p,
                      points: [p, p],
                      caution: null,
                      flow: [],
                      terms: [],
                      question: null,
                    }),
                  });
                  emit({ type: 'complete' });
                };
                if (!state.hold) state.finish();
                break;
              }
            }
          });
        },
      } as unknown as chrome.runtime.Port;
    }) as typeof chrome.runtime.connectNative;
  });
  const sources = [];
  for (let i = 0; i < 3; i++) {
    const p = await context.newPage();
    await p.goto(fixtureServer.origin + '/article#digest=' + i);
    sources.push(p);
  }
  await sources[1]!.setContent(
    '<nav>Navigation noise</nav><article>' +
      'Article evidence. '.repeat(25) +
      '</article><section id="comments">A loaded discussion counterargument.</section>',
  );
  const denied = await worker.evaluate(async () => {
    const tab = (await chrome.tabs.query({})).find((t) => t.url?.includes('/article#digest=1'))!;
    return (
      await chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        func: () =>
          chrome.runtime.sendMessage({ target: 'saul-digest', message: { action: 'list' } }),
      })
    )[0]!.result;
  });
  expect(denied).toMatchObject({ success: false, error: 'Extension workspace only' });
  await popup.getByRole('button', { name: 'Tabs', exact: true }).click();
  await expect(popup.getByRole('button', { name: 'Summarize all tabs' })).toBeEnabled();
  await popup.getByRole('button', { name: 'Summarize all tabs' }).click();
  await expect(popup.getByRole('button', { name: 'Stop digest' })).toBeVisible();
  const url = popup.url();
  await popup.close();
  const reopened = await context.newPage();
  await reopened.goto(url);
  await reopened.getByRole('button', { name: 'Tabs', exact: true }).click();
  await expect(reopened.getByRole('button', { name: 'Stop digest' })).toBeVisible();
  await reopened.getByRole('button', { name: 'Stop digest' }).click();
  await expect(reopened.getByRole('button', { name: 'Retry unfinished' })).toBeVisible();
  // The first captured page can close: retry uses the saved source, not another page.
  await sources[0]!.close();
  await worker.evaluate(() => {
    (globalThis as unknown as { digestFixture: { hold: boolean } }).digestFixture.hold = false;
  });
  await reopened.getByRole('button', { name: 'Retry unfinished' }).click();
  await expect(reopened.getByRole('status')).toContainText('3 of');
  await expect(reopened.getByRole('button', { name: 'Stop digest' })).toHaveCount(0);
  const downloadPromise = reopened.waitForEvent('download');
  await reopened.getByRole('button', { name: 'Download HTML' }).click();
  const download = await downloadPromise;
  const html = await readFile((await download.path())!, 'utf8');
  expect(html).toContain(fixtureServer.origin + '/article#digest=0');
  expect(html.indexOf('A concise source-backed finding.')).toBeLessThan(
    html.indexOf('简明且基于来源的结论。'),
  );
  expect(html).toContain('skipped');
  expect(html).not.toContain('accountId');
  const requests = await worker.evaluate(() =>
    (
      globalThis as unknown as { digestFixture: { requests: PlanRequest[] } }
    ).digestFixture.requests.filter((r) => r.action === 'generate'),
  );
  expect(requests).toHaveLength(4);
  const captured = requests[2];
  if (captured?.action === 'generate') {
    expect(captured.userPrompt).toContain('loaded discussion counterargument');
    expect(captured.userPrompt).not.toContain('Navigation noise');
  } else throw new Error('Missing request');
  expect(
    requests.every(
      (r) => r.action === 'generate' && r.model === 'gpt-6-luna' && r.effort === 'medium',
    ),
  ).toBe(true);
  await reopened.getByText('Tab results and source coverage', { exact: true }).click();
  await reopened.screenshot({ path: testInfo.outputPath('digest.png'), fullPage: true });
  await reopened.setViewportSize({ width: 420, height: 760 });
  await reopened.emulateMedia({ colorScheme: 'dark' });
  await reopened.screenshot({
    path: testInfo.outputPath('digest-dark-narrow.png'),
    fullPage: true,
  });
  const exportPage = await context.newPage();
  await exportPage.setContent(html);
  await exportPage.screenshot({ path: testInfo.outputPath('digest-export.png'), fullPage: true });
  await exportPage.close();
  await worker.evaluate(() => {
    (globalThis as unknown as { digestFixture: { hold: boolean } }).digestFixture.hold = true;
  });
  await reopened.getByRole('button', { name: 'Summarize all tabs' }).click();
  await expect
    .poll(() =>
      worker.evaluate(
        () =>
          (
            globalThis as unknown as { digestFixture: { requests: PlanRequest[] } }
          ).digestFixture.requests.filter((r) => r.action === 'generate').length,
      ),
    )
    .toBe(5);
  const relaunched = await sandbox.launch();
  await relaunched.popup.getByRole('button', { name: 'Tabs', exact: true }).click();
  await expect(relaunched.popup.getByRole('status')).toContainText('need attention');
  await expect(relaunched.popup.getByRole('button', { name: 'Stop digest' })).toHaveCount(0);
  const batch = await relaunched.popup.evaluate(async () => {
    const list = await chrome.runtime.sendMessage({
      target: 'saul-digest',
      message: { action: 'list' },
    });
    const current = (
      await chrome.runtime.sendMessage({
        target: 'saul-digest',
        message: { action: 'get', id: list.result[0].id },
      })
    ).result as DigestBatch;
    if (current.items.some((i) => ['queued', 'capturing', 'running'].includes(i.status)))
      throw new Error('Restart replayed unfinished work');
    return (
      await chrome.runtime.sendMessage({
        target: 'saul-digest',
        message: { action: 'get', id: list.result[1].id },
      })
    ).result as DigestBatch;
  });
  expect(batch.items.filter((i) => i.status === 'completed')).toHaveLength(3);
  // A second workspace may delete the selected digest. The first must fall back cleanly.
  const selector = relaunched.popup.getByLabel('Saved digests');
  await selector.selectOption(batch.id);
  await expect(relaunched.popup.getByRole('status')).toContainText('3 of');
  await relaunched.popup.evaluate(async (id) => {
    const reply = await chrome.runtime.sendMessage({
      target: 'saul-digest',
      message: { action: 'delete', id },
    });
    if (!reply.success) throw new Error(reply.error);
  }, batch.id);
  await expect(selector).not.toHaveValue(batch.id);
  await expect(relaunched.popup.getByRole('status')).toContainText('need attention');
  expect(
    await relaunched.popup.evaluate(
      async (id) =>
        (
          await chrome.runtime.sendMessage({
            target: 'saul-digest',
            message: { action: 'get', id },
          })
        ).success,
      batch.id,
    ),
  ).toBe(false);
});
