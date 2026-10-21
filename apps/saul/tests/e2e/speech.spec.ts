import { test, expect } from './fixtures.ts';
import type { PlanRequest, PlanEvent } from '../../native/plan-protocol.mjs';

test('speech widget keeps OAuth scope, supports cancellation and shows audio or endpoint rejection', async ({
  sandbox,
}, info) => {
  const { worker, popup } = await sandbox.launch();
  await worker.evaluate(() => {
    const fixture = { mode: 'hold', requests: [] as PlanRequest[], cancelled: false };
    Object.assign(globalThis, { speechFixture: fixture });
    chrome.runtime.connectNative = (() => {
      const listeners: ((message: { id: string; event: PlanEvent }) => void)[] = [];
      return {
        onMessage: { addListener: (fn: (typeof listeners)[number]) => listeners.push(fn) },
        onDisconnect: { addListener: () => {} },
        postMessage: ({
          id,
          request,
          cancel,
        }: {
          id: string;
          request: PlanRequest;
          cancel?: boolean;
        }) => {
          if (cancel) {
            fixture.cancelled = true;
            return;
          }
          fixture.requests.push(request);
          const emit = (event: PlanEvent) =>
            queueMicrotask(() => listeners.forEach((fn) => fn({ id, event })));
          if (request.action === 'accounts')
            emit({
              type: 'result',
              accounts: [
                { id: 'fixture', label: 'Fixture account', signedIn: true, planEnabled: true },
              ],
            });
          if (request.action === 'models') emit({ type: 'result', models: [] });
          if (request.action === 'speech' && fixture.mode === 'error')
            emit({
              type: 'error',
              message: 'Speech route rejected (HTTP 401) [no_matching_rule].',
            });
          if (request.action === 'speech' && fixture.mode === 'audio')
            emit({ type: 'result', mimeType: 'audio/mpeg', audioBase64: 'SUQzAA==' });
        },
        disconnect: () => {},
      } as unknown as chrome.runtime.Port;
    }) as typeof chrome.runtime.connectNative;
  });
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await popup.getByLabel('Provider', { exact: true }).selectOption('chatgpt-plan');
  const widget = popup
    .locator('details')
    .filter({ has: popup.locator('summary', { hasText: 'Speech test · experimental' }) });
  await widget.locator('summary').click();
  await expect(widget.getByRole('button', { name: 'Test speech', exact: true })).toBeEnabled();
  await widget.getByLabel('Speech text').fill(' ');
  await expect(widget.getByRole('button', { name: 'Test speech', exact: true })).toBeDisabled();
  await widget.getByLabel('Speech text').fill('Hello from a disposable fixture.');
  await widget.getByRole('button', { name: 'Test speech', exact: true }).click();
  await expect(widget.getByRole('status')).toHaveText('Requesting speech…');
  await expect(popup.getByLabel('ChatGPT account', { exact: true })).toBeDisabled();
  await expect(popup.getByLabel('Provider', { exact: true })).toBeDisabled();
  await widget.getByRole('button', { name: 'Stop speech request' }).click();
  await expect(widget.getByRole('status')).toHaveText('Stopped.');
  expect(
    await worker.evaluate(
      () =>
        (globalThis as unknown as { speechFixture: { cancelled: boolean } }).speechFixture
          .cancelled,
    ),
  ).toBe(true);
  await worker.evaluate(() => {
    (globalThis as unknown as { speechFixture: { mode: string } }).speechFixture.mode = 'audio';
  });
  await widget.getByRole('button', { name: 'Test speech', exact: true }).click();
  await expect(widget.getByRole('status')).toContainText('Speech received');
  await expect(widget.locator('audio')).toHaveAttribute('src', /^blob:/);
  await widget.screenshot({ path: info.outputPath('speech-audio-controls.png') });
  await worker.evaluate(() => {
    (globalThis as unknown as { speechFixture: { mode: string } }).speechFixture.mode = 'error';
  });
  await widget.getByRole('button', { name: 'Test speech', exact: true }).click();
  await expect(widget.getByRole('alert')).toContainText('HTTP 401');
  await expect(widget.locator('audio')).toHaveCount(0);
  for (const minimum of [true, false]) {
    await popup.getByRole('checkbox', { name: /Minimum Mode/ }).setChecked(minimum);
    if (!minimum) await popup.getByRole('button', { name: 'Got it', exact: true }).click();
    for (const width of [360, 1000])
      for (const colorScheme of ['light', 'dark'] as const) {
        await popup.setViewportSize({ width, height: 900 });
        await popup.emulateMedia({ colorScheme });
        await widget.scrollIntoViewIfNeeded();
        expect(
          await popup.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await widget.screenshot({
          path: info.outputPath(`speech-${minimum}-${width}-${colorScheme}.png`),
        });
      }
  }
  const sent = await worker.evaluate(() =>
    (
      globalThis as unknown as { speechFixture: { requests: PlanRequest[] } }
    ).speechFixture.requests.filter((r) => r.action === 'speech'),
  );
  expect(sent).toHaveLength(3);
  expect(sent[0]).toEqual({
    action: 'speech',
    accountId: 'fixture',
    voice: 'coral',
    input: 'Hello from a disposable fixture.',
  });
  await popup.bringToFront();
  await widget.locator('summary').focus();
  await expect(widget.locator('summary')).toBeFocused();
  await popup.keyboard.press('Space');
  await expect(widget).toHaveJSProperty('open', false);
  await popup.keyboard.press('Space');
  await expect(widget).toHaveJSProperty('open', true);
  await expect(widget.getByLabel('Speech text')).toHaveValue('Hello from a disposable fixture.');
});
