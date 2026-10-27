import { test, expect } from './fixtures.ts';
import { installDigestProvider } from './digest-fixture.ts';
import { summaryPanelDriver } from './summary-panel-driver.ts';

test('summary side panel keeps the source active, survives tab switches and closure, and reopens saved work without regeneration', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { context, worker, popup } = await sandbox.launch();
  await installDigestProvider(worker, true);
  const source = await context.newPage();
  await source.goto(fixtureServer.origin + '/article');
  await source.evaluate(() => {
    const paragraph = document.createElement('p');
    paragraph.textContent = 'A long section of source evidence for the inspection reader. '.repeat(
      900,
    );
    (document.querySelector('article') || document.body).append(paragraph);
  });
  const tabsBefore = await worker.evaluate(() => chrome.tabs.query({}));
  const manual = process.env.SAUL_CONTEXT_MENU_MANUAL || process.env.SAUL_SUMMARY_SHORTCUT_MANUAL;
  if (manual) {
    test.setTimeout(180_000);
    console.log('Ready for native summary gesture in disposable Chrome.');
  } else {
    await popup.getByRole('button', { name: 'Window', exact: true }).click();
    await popup
      .getByRole('checkbox', { name: 'Select Calculus reading fixture', exact: true })
      .check();
    await popup.getByRole('button', { name: 'Summarize', exact: true }).click();
  }
  await expect
    .poll(
      () =>
        worker.evaluate(
          async () => (await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).length,
        ),
      { timeout: manual ? 150_000 : 10_000 },
    )
    .toBe(1);
  const tabsAfter = await worker.evaluate(() => chrome.tabs.query({}));
  expect(tabsAfter.map((tab) => tab.id)).toEqual(tabsBefore.map((tab) => tab.id));
  expect(tabsAfter.find((tab) => tab.active)?.id).toBe(tabsBefore.find((tab) => tab.active)?.id);
  let panel = await summaryPanelDriver(context);
  try {
    await expect
      .poll(() => panel.evaluate(() => document.querySelector('h2')?.textContent))
      .toBe('Calculus reading fixture');
    await expect
      .poll(() => panel.evaluate(() => document.querySelector('[role="status"]')?.textContent))
      .toBe('Generating summary…');
    // Optional headed acceptance leaves time to inspect the real browser chrome.
    if (manual) await new Promise((resolve) => setTimeout(resolve, 8000));
    await panel.screenshot(info.outputPath('summary-side-panel-running.png'));
    await context.pages()[0]!.bringToFront();
    await expect
      .poll(() => panel.evaluate(() => document.querySelector('h2')?.textContent))
      .toBe('Calculus reading fixture');
    await source.bringToFront();
    await panel.click('Stop');
    await expect
      .poll(() => panel.evaluate(() => document.querySelector('[role="status"]')?.textContent))
      .toBe('Summary stopped');
    await worker.evaluate(() => {
      (globalThis as unknown as { digestFixture: { hold: boolean } }).digestFixture.hold = false;
    });
    await panel.click('Retry unfinished');
    await expect
      .poll(() => panel.evaluate(() => document.querySelector('[role="status"]')?.textContent))
      .toBe('Summary ready');
    const readyRoute = await panel.evaluate(() => location.hash);
    await panel.appearance('light');
    await panel.screenshot(info.outputPath('summary-side-panel-ready.png'));
    await panel.appearance('dark');
    await panel.screenshot(info.outputPath('summary-side-panel-dark.png'));
    await panel.click('Inspect input/output');
    await expect
      .poll(() =>
        panel.evaluate(
          () => document.querySelector('.saul-inspection-block pre')?.textContent?.length || 0,
        ),
      )
      .toBeGreaterThan(1000);
    for (const theme of ['light', 'dark'] as const) {
      await panel.appearance(theme);
      await panel.screenshot(info.outputPath('summary-side-panel-inspection-' + theme + '.png'));
    }
    const count = await worker.evaluate(
      () =>
        (
          globalThis as unknown as { digestFixture: { requests: { action: string }[] } }
        ).digestFixture.requests.filter((request) => request.action === 'generate').length,
    );
    // A reused result must replace the temporary action route in session storage.
    await popup.getByRole('button', { name: 'Summarize', exact: true }).click();
    await expect
      .poll(() => panel.evaluate(() => document.querySelector('.summary-reuse')?.textContent))
      .toContain('Saved summary reused');
    const persistedRoute = await worker.evaluate(
      async (windowId) => {
        const key = `saul-summary-panel-${windowId}`;
        return (await chrome.storage.session.get(key))[key];
      },
      tabsBefore.find((tab) => tab.url === source.url())!.windowId,
    );
    expect(persistedRoute).toBe(readyRoute);
    await source.goto(fixtureServer.origin + '/anchors');
    await panel.evaluate(() => location.reload());
    await expect
      .poll(() =>
        panel
          .evaluate(() => document.querySelector('[role="status"]')?.textContent)
          .catch(() => undefined),
      )
      .toBe('Summary ready');
    expect(await panel.evaluate(() => location.hash)).toBe(readyRoute);
    if (process.env.SAUL_SUMMARY_CLOSE_MANUAL) {
      test.setTimeout(180_000);
      console.log('Ready for native Control+W in disposable Chrome.');
      await expect
        .poll(
          () =>
            worker.evaluate(
              async () =>
                (await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).length,
            ),
          { timeout: 150_000 },
        )
        .toBe(0);
      expect((await worker.evaluate(() => chrome.tabs.query({}))).map((tab) => tab.id)).toEqual(
        tabsBefore.map((tab) => tab.id),
      );
    } else
      await panel.evaluate(() =>
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'w',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    await panel.detach();

    await expect
      .poll(() =>
        worker.evaluate(
          async () => (await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).length,
        ),
      )
      .toBe(0);
    await source.close();
    await popup.getByRole('button', { name: 'History', exact: true }).click();
    await popup.getByRole('button', { name: 'Summaries', exact: true }).click();
    await popup.getByRole('region', { name: 'Saved summaries' }).getByRole('button').click();
    await expect
      .poll(() =>
        worker.evaluate(
          async () => (await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).length,
        ),
      )
      .toBe(1);
    panel = await summaryPanelDriver(context);
    await expect
      .poll(() => panel.evaluate(() => document.querySelector('[role="status"]')?.textContent))
      .toBe('Summary ready');
    expect(await panel.evaluate(() => location.hash)).toBe(readyRoute);
    expect(
      await worker.evaluate(
        () =>
          (
            globalThis as unknown as { digestFixture: { requests: { action: string }[] } }
          ).digestFixture.requests.filter((request) => request.action === 'generate').length,
      ),
    ).toBe(count);
    await panel.click('← Saved summaries');
    await expect
      .poll(() => panel.evaluate(() => document.querySelector('h2')?.textContent))
      .toBe('Saved summaries');
    await expect
      .poll(() => panel.evaluate(() => document.querySelectorAll('.summary-entry').length))
      .toBe(1);
    await panel.evaluate(() =>
      document.querySelector<HTMLButtonElement>('.summary-entry')!.click(),
    );
    await expect
      .poll(() => panel.evaluate(() => document.querySelector('[role="status"]')?.textContent))
      .toBe('Summary ready');
  } finally {
    await panel.detach();
  }
});
