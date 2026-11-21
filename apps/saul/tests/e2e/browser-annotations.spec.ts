import { test, expect } from './fixtures.ts';
import { configureFixtureProvider, type ExtensionSandbox, type FixtureServer } from './support.ts';
import { summaryPanelDriver } from './summary-panel-driver.ts';
import type { Annotation, AnnotationResult } from '../../shared/protocol/annotations.ts';
import type { AnnotationEditorStatus } from '../../shared/protocol/annotation-attempts.ts';

test.use({ browserToolsFixtures: true });
test('annotation status recovers at startup and attaches an image at the same revision', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { context, popup, worker } = await sandbox.launch();
  const source = await context.newPage();
  await source.goto(fixtureServer.origin + '/article');
  const id = 'late-image-fixture';
  const url = source.url();
  const seeded = await popup.evaluate(
    async ({ id, url }) => {
      await chrome.storage.local.set({
        ['saul-annotation-draft-' + id]: { text: 'Recovered unsaved comment', revision: 1 },
      });
      return chrome.runtime.sendMessage({
        target: 'saul-annotation',
        action: 'operate',
        url,
        operation: {
          action: 'create',
          capture: {
            id,
            url,
            title: 'Late image fixture',
            comment: 'Original saved comment',
            target: {
              kind: 'element',
              label: 'Synthetic late image',
              frame: 'top document',
              rect: { x: 0, y: 0, width: 100, height: 100 },
              viewport: { width: 800, height: 600, scrollX: 0, scrollY: 0, scale: 1 },
            },
          },
        },
      });
    },
    { id, url },
  );
  expect(seeded).toMatchObject({ success: true });
  await worker.evaluate((id) => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime) as (
      input: unknown,
    ) => Promise<unknown>;
    const held = Promise.withResolvers<void>();
    const probe = {
      reads: 0,
      inFlight: 0,
      maxInFlight: 0,
      snapshots: [] as { revision: number; hasRecord: boolean; hasImage: boolean }[],
      release: held.resolve,
    };
    Object.assign(globalThis, { annotationStatusProbe: probe });
    chrome.runtime.sendMessage = (async (input: {
      target?: string;
      message?: { type?: string; payload?: { id?: string } };
    }) => {
      if (
        input.target !== 'saul-offscreen' ||
        input.message?.type !== 'DB_ANNOTATION_STATUS' ||
        input.message.payload?.id !== id
      )
        return original(input);
      const read = ++probe.reads;
      probe.inFlight++;
      probe.maxInFlight = Math.max(probe.maxInFlight, probe.inFlight);
      try {
        if (read === 1)
          return { success: false, error: 'Fixture interrupted the first annotation status read.' };
        if (read === 2) await held.promise;
        const result = (await original(input)) as { result?: AnnotationEditorStatus };
        if (result.result?.kind === 'found')
          probe.snapshots.push({
            revision: result.result.key.revision,
            hasRecord: !!result.result.record,
            hasImage: result.result.capture?.kind === 'available',
          });
        return result;
      } finally {
        probe.inFlight--;
      }
    }) as typeof chrome.runtime.sendMessage;
  }, id);
  await source.bringToFront();
  await expect(source.locator('saul-root')).toBeAttached();
  await source.locator('#concept').click({ clickCount: 3 });
  await source.getByRole('button', { name: 'Annotate', exact: true }).click();
  const sidePanelCount = () =>
    worker.evaluate(
      async () => (await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).length,
    );
  const open = source.getByRole('button', { name: 'Open annotation', exact: true });
  await expect
    .poll(async () => (await sidePanelCount()) > 0 || (await open.isVisible()))
    .toBe(true);
  if (await open.isVisible()) await open.click();
  await expect.poll(sidePanelCount).toBe(1);
  const panel = await summaryPanelDriver(context);
  try {
    await expect
      .poll(() => panel.evaluate(() => document.querySelectorAll('.annotation-item').length))
      .toBe(2);
    await panel.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('.annotation-item'))
        .find((item) => item.textContent?.includes('Synthetic late image'))!
        .click(),
    );
    await expect
      .poll(() => panel.evaluate(() => document.querySelector('[role="alert"]')?.textContent))
      .toContain('Fixture interrupted the first annotation status read');
    await panel.click('Refresh status');
    await panel.click('Refresh status');
    const before = await worker.evaluate(() => {
      const probe = (
        globalThis as typeof globalThis & {
          annotationStatusProbe: { reads: number; maxInFlight: number; release: () => void };
        }
      ).annotationStatusProbe;
      probe.release();
      return { reads: probe.reads, maxInFlight: probe.maxInFlight };
    });
    expect(before).toEqual({ reads: 2, maxInFlight: 1 });
    const comment = () =>
      panel.evaluate(
        () => document.querySelector<HTMLTextAreaElement>('#annotation-comment')?.value,
      );
    await expect.poll(comment).toBe('Recovered unsaved comment');
    await expect
      .poll(() => panel.evaluate(() => document.querySelector('.annotation-editor')?.textContent))
      .toContain('No image saved.');

    // The generated JPEG simulates delayed viewport processing without depending
    // on a second screenshot; shared storage and its version event stay real.
    const image = await popup.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 80;
      canvas.height = 60;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#172844';
      context.fillRect(0, 0, 80, 60);
      return canvas.toDataURL('image/jpeg');
    });
    expect(image).toMatch(/^data:image\/jpeg;base64,/);
    const attached = await worker.evaluate(
      async ({ id, image }) => {
        const result = await chrome.runtime.sendMessage({
          target: 'saul-offscreen',
          operation: 'db',
          message: { type: 'DB_ANNOTATION_IMAGE', payload: { id, image } },
        });
        await chrome.storage.session.set({ 'saul-annotation-version': crypto.randomUUID() });
        return result.success;
      },
      { id, image },
    );
    expect(attached).toBe(true);
    await expect
      .poll(() =>
        panel.evaluate(
          () =>
            document.querySelector<HTMLImageElement>('.annotation-editor figure img')?.naturalWidth,
        ),
      )
      .toBe(80);
    await panel.screenshot(info.outputPath('annotation-late-image.png'));
    await expect.poll(comment).toBe('Recovered unsaved comment');
    const snapshots = await worker.evaluate(
      () =>
        (globalThis as typeof globalThis & { annotationStatusProbe: { snapshots: unknown[] } })
          .annotationStatusProbe.snapshots,
    );
    expect(snapshots).toContainEqual({ revision: 1, hasRecord: true, hasImage: false });
    expect(snapshots).toContainEqual({ revision: 1, hasRecord: false, hasImage: true });
  } finally {
    await panel.detach();
  }
});

async function openSelectionEditor(sandbox: ExtensionSandbox, fixtureServer: FixtureServer) {
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
  await expect
    .poll(() => panel.evaluate(() => document.querySelector('.annotation-editor h2')?.textContent))
    .toBe('Annotation 1');
  return { panel, popup, source };
}

test('reply submission admits one append and keeps the next draft', async ({
  sandbox,
  fixtureServer,
}) => {
  const { panel } = await openSelectionEditor(sandbox, fixtureServer);
  const typeReply = (value: string) =>
    panel.evaluate((value) => {
      const field = document.querySelector<HTMLTextAreaElement>('#annotation-reply')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        field,
        value,
      );
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  try {
    await panel.evaluate(() => {
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      const hold = Promise.withResolvers<void>();
      Object.assign(globalThis, { releaseAnnotationReply: hold.resolve });
      chrome.runtime.sendMessage = (async (message: {
        action?: string;
        operation?: { changes?: { action: string }[] };
      }) => {
        if (message.action === 'operate' && message.operation?.changes?.[0]?.action === 'append')
          await hold.promise;
        return original(message);
      }) as typeof chrome.runtime.sendMessage;
    });
    await typeReply('First reply');
    await panel.evaluate(() => {
      const form = document.querySelector<HTMLTextAreaElement>('#annotation-reply')!.form!;
      for (let i = 0; i < 2; i++)
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await expect
      .poll(() =>
        panel.evaluate(
          () => document.querySelector<HTMLButtonElement>('#annotation-reply + button')?.disabled,
        ),
      )
      .toBe(true);
    await typeReply('Next reply');
    await panel.evaluate(() => {
      (
        globalThis as typeof globalThis & { releaseAnnotationReply: () => void }
      ).releaseAnnotationReply();
    });
    await expect
      .poll(() =>
        panel.evaluate(() => ({
          replies: Array.from(
            document.querySelectorAll('.annotation-replies p'),
            (p) => p.textContent,
          ),
          draft: document.querySelector<HTMLTextAreaElement>('#annotation-reply')?.value,
          pending: document.querySelector<HTMLButtonElement>('#annotation-reply + button')
            ?.disabled,
        })),
      )
      .toEqual({ replies: ['First reply'], draft: 'Next reply', pending: false });
  } finally {
    await panel.detach();
  }
});

test('queued edits preserve a concurrent comment and an older save cannot erase another editor’s draft', async ({
  sandbox,
  fixtureServer,
}) => {
  const { panel, popup, source } = await openSelectionEditor(sandbox, fixtureServer);
  try {
    // Deliver another writer's edit between the editor's first accepted write and its read-back.
    await panel.evaluate(() => {
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      const held = Promise.withResolvers<void>();
      const conflict = { injected: false, release: held.resolve };
      Object.assign(globalThis, { annotationConflict: conflict });
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
          conflict.injected = true;
          await held.promise;
        }
        return result;
      }) as typeof chrome.runtime.sendMessage;
      const el = document.querySelector<HTMLTextAreaElement>('#annotation-comment')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        el,
        'First local draft',
      );
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect
      .poll(() =>
        panel.evaluate(
          () =>
            (globalThis as typeof globalThis & { annotationConflict: { injected: boolean } })
              .annotationConflict.injected,
        ),
      )
      .toBe(true);
    await panel.evaluate(() => {
      const el = document.querySelector<HTMLTextAreaElement>('#annotation-comment')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        el,
        'Newest local draft',
      );
      el.dispatchEvent(new Event('input', { bubbles: true }));
      (
        globalThis as typeof globalThis & { annotationConflict: { release: () => void } }
      ).annotationConflict.release();
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

    // Hold the old editor's accepted save acknowledgement while a second
    // trusted extension context caches newer text for the same annotation.
    const active = await read();
    await panel.evaluate(() => {
      const original = chrome.runtime.sendMessage.bind(chrome.runtime) as (
        message: unknown,
      ) => Promise<unknown>;
      const held = Promise.withResolvers<void>();
      const pending = { acknowledged: false, release: held.resolve };
      Object.assign(globalThis, { pendingAnnotationSave: pending });
      chrome.runtime.sendMessage = (async (message: {
        action?: string;
        operation?: { changes?: { action: string }[] };
      }) => {
        const reply = await original(message);
        if (message.action === 'operate' && message.operation?.changes?.[0]?.action === 'edit') {
          pending.acknowledged = true;
          await held.promise;
        }
        return reply;
      }) as typeof chrome.runtime.sendMessage;
      const comment = document.querySelector<HTMLTextAreaElement>('#annotation-comment')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        comment,
        'Older editor saved this comment',
      );
      comment.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect
      .poll(() =>
        panel.evaluate(
          () =>
            (globalThis as typeof globalThis & { pendingAnnotationSave: { acknowledged: boolean } })
              .pendingAnnotationSave.acknowledged,
        ),
      )
      .toBe(true);
    expect((await read()).comment).toBe('Older editor saved this comment');
    const newer = {
      id: active.id,
      token: crypto.randomUUID(),
      text: 'A newer draft in another editor',
      revision: active.revision + 1,
    };
    const newerReply = await popup.evaluate(
      (newer) =>
        chrome.runtime.sendMessage({
          target: 'saul-annotation',
          action: 'draft',
          mutation: { action: 'write', ...newer },
        }),
      newer,
    );
    expect(newerReply.success).toBe(true);
    await panel.evaluate(() =>
      (
        globalThis as typeof globalThis & { pendingAnnotationSave: { release: () => void } }
      ).pendingAnnotationSave.release(),
    );
    await expect
      .poll(() =>
        panel.evaluate(
          () => document.querySelector('.annotation-editor [role="status"]')?.textContent,
        ),
      )
      .toBe('Saved');
    const cached = () =>
      popup.evaluate(async (id) => {
        const key = 'saul-annotation-draft-' + id;
        return (await chrome.storage.local.get(key))[key];
      }, active.id);
    expect(await cached()).toEqual({
      token: newer.token,
      text: newer.text,
      revision: newer.revision,
    });

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
    await expect.poll(cached).toBeUndefined();
  } finally {
    await panel.detach();
  }
});

test('captures text before opening the native panel, saves drafts, replies through a Call, and restores after restart @smoke', async ({
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
  const inferenceBefore = fixtureServer.requests.length;
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
    expect(fixtureServer.requests).toHaveLength(inferenceBefore);
    sandbox.rejectHistoryWriteOnce(
      ({ type, payload }) =>
        type === 'DB_ANNOTATION_ATTEMPT' && (payload as { action: string }).action === 'complete',
    );
    await panel.click('Run · 1');
    await expect
      .poll(() =>
        panel.evaluate(
          () => document.querySelector('.annotation-editor [role="alert"]')?.textContent,
        ),
      )
      .toContain('Could not save the annotation response');
    expect(
      await panel.evaluate(() => document.querySelectorAll('.annotation-replies li').length),
    ).toBe(0);
    expect(await panel.evaluate(() => document.body.textContent)).not.toContain(
      'Save reply without generating',
    );
    expect(fixtureServer.requests).toHaveLength(inferenceBefore + 1);
    await panel.click('Run · 1');
    await expect
      .poll(
        () => panel.evaluate(() => document.querySelectorAll('.annotation-replies li').length),
        { timeout: 15000 },
      )
      .toBe(1);
    expect(fixtureServer.requests).toHaveLength(inferenceBefore + 2);
    const body = fixtureServer.requests.at(-1)!.body;
    expect(body).toContain('Untrusted page evidence');
    expect(body).toContain('image_url');
    expect(body).toContain('Explain the selected concept');
    await panel.evaluate(() => {
      const inspect = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent === 'Inspect input/output',
      )!;
      inspect.click();
    });
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
