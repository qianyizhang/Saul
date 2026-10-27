import type { BrowserContext } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Chrome exposes native side panels as "other" CDP targets, not Playwright Pages.
// Attach within the existing sandbox; no second browser or launch configuration.
export async function summaryPanelDriver(context: BrowserContext) {
  const connection = await context.browser()!.newBrowserCDPSession();
  const { targetInfos } = await connection.send('Target.getTargets');
  const target = targetInfos.find((target: { url: string }) =>
    target.url.includes('/summary-panel.html'),
  );
  if (!target) {
    await connection.detach();
    throw new Error('Summary side-panel target is missing.');
  }
  const { sessionId } = await connection.send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: false,
  });
  let sequence = 0;
  let detached = false;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  connection.on('Target.receivedMessageFromTarget', (event) => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  function send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++sequence;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: (value) => resolve(value as T), reject });
      void connection
        .send('Target.sendMessageToTarget', {
          sessionId,
          message: JSON.stringify({ id, method, params }),
        })
        .catch((error: Error) => {
          pending.delete(id);
          reject(error);
        });
    });
  }
  async function evaluate<T, A = undefined>(body: (argument: A) => T, argument?: A): Promise<T> {
    const result = await send<{ result: { value: T }; exceptionDetails?: { text: string } }>(
      'Runtime.evaluate',
      {
        expression: '(' + body.toString() + ')(' + JSON.stringify(argument) + ')',
        returnByValue: true,
        awaitPromise: true,
      },
    );
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  return {
    evaluate,
    async appearance(value: 'light' | 'dark') {
      await send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value }],
      });
    },
    async click(name: string) {
      await evaluate((name) => {
        const control = Array.from(
          document.querySelectorAll<HTMLElement>('button, a, summary'),
        ).find(
          (element) =>
            element.textContent?.trim() === name || element.getAttribute('aria-label') === name,
        );
        if (!control) throw new Error('Missing side-panel control: ' + name);
        control.click();
      }, name);
    },
    async screenshot(path: string) {
      const { data } = await send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
      await writeFile(path, Buffer.from(data, 'base64'));
    },
    async detach() {
      if (detached) return;
      detached = true;
      for (const waiter of pending.values()) waiter.reject(new Error('Side-panel driver closed.'));
      pending.clear();
      await connection.detach();
    },
  };
}
