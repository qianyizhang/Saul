import { test, expect } from './fixtures.ts';
import { configureFixtureProvider } from './support.ts';
import { summaryPanelDriver } from './summary-panel-driver.ts';
import type { Annotation, AnnotationResult } from '../../src/annotations/contract';

test.use({ browserToolsFixtures: true });
test('queued comment edits preserve a concurrent edit and recover the local draft explicitly', async ({
  sandbox,
  fixtureServer,
}) => {
  const { context, popup, worker } = await sandbox.launch();
  const source = await context.newPage();
  await source.goto(fixtureServer.origin + '/article');
  await source.bringToFront();
  await expect(source.locator('saul-root')).toBeAttached();
  await source.locator('#concept').click({ clickCount: 3 });
  await source.getByRole('button', { name: 'Annotate', exact: true }).click();
  // Screenshot capture may outlive Chrome's gesture. Exercise its explicit recovery action.
  await expect
    .poll(
      async () =>
        (await worker.evaluate(
          async () => (await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).length,
        )) > 0 ||
        (await source.getByRole('button', { name: 'Open annotation', exact: true }).isVisible()),
    )
    .toBe(true);
  if (await source.getByRole('button', { name: 'Open annotation', exact: true }).isVisible())
    await source.getByRole('button', { name: 'Open annotation', exact: true }).click();
  await expect
    .poll(() =>
      worker.evaluate(
        async () => (await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).length,
      ),
    )
    .toBe(1);
  const panel = await summaryPanelDriver(context);
  try {
    await expect
      .poll(() =>
        panel.evaluate(() => document.querySelector('.annotation-editor h2')?.textContent),
      )
      .toBe('Annotation 1');
    // Deliver another writer's edit between the editor's first accepted write and its read-back.
    await panel.evaluate(() => {
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      let inject = true;
      chrome.runtime.sendMessage = (async (message: {
        action?: string;
        operation?: { action?: string; changes?: { action: string }[] };
        url?: string;
      }) => {
        const result = await original(message);
        if (
          inject &&
          message.action === 'operate' &&
          message.operation?.changes?.[0]?.action === 'edit'
        ) {
          inject = false;
          const a = result.result.outcomes[0].record as Annotation;
          await original({
            target: 'saul-annotation',
            action: 'operate',
            url: a.url,
            operation: {
              action: 'change',
              changes: [
                {
                  id: a.id,
                  revision: a.revision,
                  operationId: 'concurrent-edit',
                  action: 'edit',
                  text: 'Another writer’s comment',
                },
              ],
            },
          });
        }
        return result;
      }) as typeof chrome.runtime.sendMessage;
      const el = document.querySelector<HTMLTextAreaElement>('#annotation-comment')!;
      for (const value of ['First local draft', 'Newest local draft']) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
          el,
          value,
        );
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await expect
      .poll(() =>
        panel.evaluate(
          () => document.querySelector('.annotation-editor [role="alert"]')?.textContent,
        ),
      )
      .toContain('Annotation changed');
    await expect
      .poll(() =>
        panel.evaluate(
          () => document.querySelector<HTMLTextAreaElement>('#annotation-comment')?.value,
        ),
      )
      .toBe('Newest local draft');
    const read = () =>
      popup.evaluate(async (url) => {
        const r = await chrome.runtime.sendMessage({
          target: 'saul-annotation',
          action: 'operate',
          url,
          operation: { action: 'list', url, filter: 'all', offset: 0 },
        });
        return r.result.records[0] as Annotation;
      }, source.url());
    expect((await read()).comment).toBe('Another writer’s comment');
    await panel.click('Save draft against latest');
    await expect.poll(async () => (await read()).comment).toBe('Newest local draft');
    await expect
      .poll(() =>
        panel.evaluate(
          () => document.querySelector('.annotation-editor [role="status"]')?.textContent,
        ),
      )
      .toBe('Saved');
    await panel.click('Delete annotation');
    await expect
      .poll(() => panel.evaluate(() => !!document.querySelector('.annotation-editor')))
      .toBe(false);
    await panel.evaluate(() => {
      const filter = document.querySelector<HTMLSelectElement>('select')!;
      filter.value = 'deleted';
      filter.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect
      .poll(() => panel.evaluate(() => document.querySelectorAll('.annotation-item').length))
      .toBe(1);
    await panel.evaluate(() =>
      document.querySelector<HTMLButtonElement>('.annotation-item')!.click(),
    );
    await expect
      .poll(() => panel.evaluate(() => document.querySelector('.annotation-editor')?.textContent))
      .toContain('Delete permanently');
    await panel.click('Delete permanently');
    await expect
      .poll(() => panel.evaluate(() => !!document.querySelector('.annotation-editor')))
      .toBe(false);
  } finally {
    await panel.detach();
  }
});

test('captures text before opening the native panel, saves drafts, replies through a Call, and restores after restart', async ({
  sandbox,
  fixtureServer,
}, info) => {
  let { context, popup, worker } = await sandbox.launch();
  await configureFixtureProvider(popup, fixtureServer.origin);
  await popup.evaluate(async () => {
    const v = (await chrome.storage.local.get('saul_user_settings')).saul_user_settings as {
      openaiCompatible: { model: string };
      configuration: { presets: { model: string }[] };
    };
    v.openaiCompatible.model = 'gpt-6';
    v.configuration.presets[0]!.model = 'gpt-6';
    await chrome.storage.local.set({ saul_user_settings: v });
  });
  const source = await context.newPage();
  await source.goto(fixtureServer.origin + '/article');
  await source.bringToFront();
  await expect(source.locator('saul-root')).toBeAttached();
  await source.locator('#concept').click({ clickCount: 3 });
  await source.getByRole('button', { name: 'Annotate', exact: true }).click();
  await expect
    .poll(() =>
      worker.evaluate(
        async () => (await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).length,
      ),
    )
    .toBe(1);
  const panel = await summaryPanelDriver(context);
  const fill = async (selector: string, value: string) =>
    panel.evaluate(
      ({ selector, value }) => {
        const el = document.querySelector<HTMLTextAreaElement>(selector)!;
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
          el,
          value,
        );
        el.dispatchEvent(new Event('input', { bubbles: true }));
      },
      { selector, value },
    );
  try {
    await expect
      .poll(() =>
        panel.evaluate(() => document.querySelector('.annotation-editor h2')?.textContent),
      )
      .toBe('Annotation 1');
    await expect
      .poll(() =>
        panel.evaluate(
          () =>
            document.querySelector<HTMLImageElement>('.annotation-editor img')?.naturalWidth ?? 0,
        ),
      )
      .toBeGreaterThan(0);
    await fill('#annotation-comment', 'Explain the selected concept and propose a clearer label.');
    await expect
      .poll(() =>
        panel.evaluate(
          () => document.querySelector('.annotation-editor [role="status"]')?.textContent,
        ),
      )
      .toBe('Saved');
    await panel.evaluate(() =>
      document.querySelector<HTMLTextAreaElement>('#annotation-comment')!.blur(),
    );
    const saved = await popup.evaluate(async (url) => {
      const r = await chrome.runtime.sendMessage({
        target: 'saul-annotation',
        action: 'operate',
        url,
        operation: { action: 'list', url, filter: 'all', offset: 0 },
      });
      return r.result as AnnotationResult;
    }, fixtureServer.origin + '/article');
    const id = saved.records![0]!.id;
    expect(saved.records![0]!.target.kind).toBe('text');
    expect(saved.records![0]!.hasImage).toBe(true);
    await panel.click('Respond to annotations · 1');
    await panel.evaluate(() => {
      const select = [...document.querySelectorAll<HTMLSelectElement>('select')].find((s) =>
        s.parentElement?.textContent?.startsWith('Model preset'),
      )!;
      select.value = select.options[1]!.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await panel.click('Run · 1');
    await expect
      .poll(
        () => panel.evaluate(() => document.querySelectorAll('.annotation-replies li').length),
        { timeout: 15000 },
      )
      .toBe(1);
    const body = fixtureServer.requests.at(-1)!.body;
    expect(body).toContain('Untrusted page evidence');
    expect(body).toContain('image_url');
    expect(body).toContain('Explain the selected concept');
    await panel.click('Inspect input/output');
    await expect
      .poll(() => panel.evaluate(() => document.body.textContent))
      .toContain('Recorded model input/output');
    await panel.appearance('light');
    await panel.evaluate(() =>
      document.querySelector('#annotation-comment')?.scrollIntoView({ block: 'center' }),
    );
    await panel.screenshot(info.outputPath('annotation-light.png'));
    await panel.appearance('dark');
    await panel.screenshot(info.outputPath('annotation-dark.png'));
    await panel.evaluate(() => {
      const label = [...document.querySelectorAll('label')].find((l) => l.textContent === 'Done')!;
      label.querySelector<HTMLInputElement>('input')!.click();
    });
    await expect
      .poll(async () => {
        const r = await popup.evaluate(
          async ({ url, id }) =>
            (
              await chrome.runtime.sendMessage({
                target: 'saul-annotation',
                action: 'operate',
                url,
                operation: { action: 'read', id, image: false },
              })
            ).result.record as Annotation,
          { url: fixtureServer.origin + '/article', id },
        );
        return r.state;
      })
      .toBe('done');
    await panel.detach();
    ({ context, popup, worker } = await sandbox.launch());
    const restored = await popup.evaluate(
      async ({ url, id }) =>
        (
          await chrome.runtime.sendMessage({
            target: 'saul-annotation',
            action: 'operate',
            url,
            operation: { action: 'read', id, image: true },
          })
        ).result.record as Annotation,
      { url: fixtureServer.origin + '/article', id },
    );
    expect(restored.comment).toContain('Explain the selected');
    expect(restored.replies).toHaveLength(1);
    expect(restored.state).toBe('done');
    expect(restored.image).toMatch(/^data:image\/jpeg/);
  } finally {
    await panel.detach();
  }
});

test('element and area picking preserve source DOM and Escape cancels', async ({
  sandbox,
  fixtureServer,
}) => {
  const { context, popup, worker } = await sandbox.launch();
  const source = await context.newPage();
  await source.goto(fixtureServer.origin + '/article');
  await source.bringToFront();
  await expect(source.locator('saul-root')).toBeAttached();
  const start = () =>
    worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(tab!.id!, { type: 'SAUL_ANNOTATE' });
    });
  await start();
  await expect(source.getByRole('dialog', { name: 'Select an annotation target' })).toBeVisible();
  await source.keyboard.press('Escape');
  await expect(source.locator('saul-annotation-overlay')).toHaveCount(0);
  await start();
  const rect = await source.locator('#concept').boundingBox();
  await source.mouse.click(rect!.x + 10, rect!.y + 10);
  await expect
    .poll(async () =>
      popup.evaluate(
        async (url) =>
          (
            await chrome.runtime.sendMessage({
              target: 'saul-annotation',
              action: 'operate',
              url,
              operation: { action: 'list', url, filter: 'all', offset: 0 },
            })
          ).result.records.length,
        fixtureServer.origin + '/article',
      ),
    )
    .toBe(1);
  await source.bringToFront();
  await start();
  await source.mouse.move(50, 60);
  await source.mouse.down();
  await source.mouse.move(260, 180, { steps: 4 });
  await source.mouse.up();
  await expect
    .poll(async () =>
      popup.evaluate(
        async (url) =>
          (
            await chrome.runtime.sendMessage({
              target: 'saul-annotation',
              action: 'operate',
              url,
              operation: { action: 'list', url, filter: 'all', offset: 0 },
            })
          ).result.records
            .map((a: Annotation) => a.target.kind)
            .join(','),
        fixtureServer.origin + '/article',
      ),
    )
    .toBe('element,area');
  await expect(source.locator('#concept')).toHaveText('Gradient descent');
  await source.evaluate(() => {
    const input = document.createElement('div');
    input.setAttribute('contenteditable', '');
    input.id = 'editable-annotation-fixture';
    input.textContent = 'Editable text';
    document.body.append(input);
    input.focus();
  });
  await start();
  await expect(source.locator('saul-annotation-overlay')).toHaveCount(0);
});

test('agent bridge opt-in, scoped append, conflicts, delete and restore share the real annotation store', async ({
  sandbox,
  fixtureServer,
}) => {
  const { popup, context, worker } = await sandbox.launch();
  const page = await context.newPage();
  await page.goto(fixtureServer.origin + '/article');
  await page.bringToFront();
  await expect(page.locator('saul-root')).toBeAttached();
  await page.locator('#concept').click({ clickCount: 3 });
  await page.getByRole('button', { name: 'Annotate', exact: true }).click();
  const url = page.url();
  const request = {
    scope: { urls: [url], ids: [] as string[] },
    author: { kind: 'agent' as const, name: 'Codex' },
    operation: { action: 'list' as const, url, filter: 'all' as const, offset: 0 },
  };
  const call = (request: unknown) =>
    popup.evaluate(async (request) => {
      const response = await chrome.runtime.sendMessage({
        target: 'saul-fixture-annotation-bridge',
        request,
      });
      if (response.error) throw new Error(response.error);
      return response.result as AnnotationResult;
    }, request);
  await expect(call(request)).rejects.toThrow('Enable Annotation access');
  await worker.evaluate(() => chrome.storage.local.set({ saul_annotation_access: true }));
  await expect.poll(async () => (await call(request)).records?.length).toBe(1);
  let a = (await call(request)).records![0]!;
  const append = {
    ...request,
    operation: {
      action: 'change',
      changes: [
        {
          id: a.id,
          revision: a.revision,
          operationId: 'agent-reply',
          action: 'append',
          text: 'Agent reply',
        },
      ],
    },
  };
  expect((await call(append)).outcomes![0]!.record!.replyCount).toBe(1);
  expect((await call(append)).outcomes![0]!.record!.replyCount).toBe(1);
  expect(
    (
      await call({
        ...append,
        operation: {
          action: 'change',
          changes: [{ ...append.operation.changes[0], operationId: 'stale-edit' }],
        },
      })
    ).outcomes![0]!.error,
  ).toContain('changed');
  await expect(
    call({
      ...request,
      scope: { urls: ['https://outside.test/'], ids: [] },
      operation: { action: 'read', id: a.id, image: false },
    }),
  ).rejects.toThrow('scope');
  a = (await call(request)).records![0]!;
  await call({
    ...request,
    operation: {
      action: 'change',
      changes: [{ id: a.id, revision: a.revision, operationId: 'delete', action: 'delete' }],
    },
  });
  expect((await call(request)).records).toHaveLength(0);
  a = (await call({ ...request, operation: { ...request.operation, filter: 'deleted' } }))
    .records![0]!;
  await call({
    ...request,
    operation: {
      action: 'change',
      changes: [{ id: a.id, revision: a.revision, operationId: 'restore', action: 'restore' }],
    },
  });
  const restored = (
    await call({ ...request, operation: { action: 'read', id: a.id, image: true } })
  ).record!;
  expect(restored.replies[0]!.author.kind).toBe('agent');
  expect(restored.image).toMatch(/^data:image/);
});

for (const race of ['navigation', 'scroll', 'zoom'] as const)
  test(`${race} during screenshot capture discards pixels but retains the original page annotation`, async ({
    sandbox,
    fixtureServer,
  }) => {
    const { popup, context, worker } = await sandbox.launch();
    const page = await context.newPage();
    await page.goto(fixtureServer.origin + '/article');
    await page.bringToFront();
    await expect(page.locator('saul-root')).toBeAttached();
    await worker.evaluate(
      ({ destination, race }) => {
        const original = chrome.tabs.captureVisibleTab;
        chrome.tabs.captureVisibleTab = ((
          windowId: number,
          options: chrome.extensionTypes.ImageDetails,
          callback: (data: string) => void,
        ) => {
          void chrome.tabs.query({ active: true, windowId }).then(async ([tab]) => {
            if (race === 'zoom') {
              await chrome.tabs.setZoom(tab!.id!, 1.25);
            } else if (race === 'scroll') {
              await chrome.scripting.executeScript({
                target: { tabId: tab!.id! },
                func: () => {
                  document.body.style.minHeight = '3000px';
                  scrollTo(0, 200);
                },
              });
            } else
              await new Promise<void>((resolve) => {
                const updated = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
                  if (id === tab!.id && info.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(updated);
                    resolve();
                  }
                };
                chrome.tabs.onUpdated.addListener(updated);
                void chrome.tabs.update(tab!.id!, { url: destination });
              });
            original(windowId, options, callback);
          });
        }) as typeof chrome.tabs.captureVisibleTab;
      },
      { destination: fixtureServer.origin + '/anchors', race },
    );
    await page.locator('#concept').click({ clickCount: 3 });
    await page.getByRole('button', { name: 'Annotate', exact: true }).click();
    const url = fixtureServer.origin + '/article';
    await expect
      .poll(async () =>
        popup.evaluate(
          async (url) =>
            (
              await chrome.runtime.sendMessage({
                target: 'saul-annotation',
                action: 'operate',
                url,
                operation: { action: 'list', url, filter: 'all', offset: 0 },
              })
            ).result.records.length,
          url,
        ),
      )
      .toBe(1);
    const saved = await popup.evaluate(
      async (url) =>
        (
          await chrome.runtime.sendMessage({
            target: 'saul-annotation',
            action: 'operate',
            url,
            operation: { action: 'list', url, filter: 'all', offset: 0 },
          })
        ).result as AnnotationResult,
      url,
    );
    expect(saved.records![0]!.hasImage).toBe(false);
    expect(saved.records![0]!.url).toBe(url);
    await expect
      .poll(async () =>
        popup.evaluate(
          async (url) =>
            (
              await chrome.runtime.sendMessage({
                target: 'saul-annotation',
                action: 'operate',
                url,
                operation: { action: 'list', url, filter: 'all', offset: 0 },
              })
            ).result.records[0].imageError,
          url,
        ),
      )
      .toContain(race === 'scroll' ? 'scrolled' : 'changed');
  });
