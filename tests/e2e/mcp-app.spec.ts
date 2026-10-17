import { test, expect } from './fixtures.ts';
import type { FrameLocator, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createWorkspace, revision } from '../../native/workspace.mjs';
import type { TabSnapshot } from '../../native/protocol.mjs';
import type { ExtensionSandbox, FixtureServer } from './support.ts';

test.use({ browserToolsFixtures: true });

async function captureWorkspace(host: Page, ui: FrameLocator, path: string) {
  // Expand the fixture frame for an uncropped capture; do not alter app styles or controls.
  const height = await ui.locator('body').evaluate(() => {
    window.scrollTo(0, 0);
    return document.documentElement.scrollHeight;
  });
  const frame = host.locator('iframe');
  await frame.evaluate((node, height) => {
    node.style.height = `${height}px`;
  }, height);
  await host.screenshot({ path, fullPage: true });
  await frame.evaluate((node) => {
    node.style.height = '900px';
  });
}

async function openWorkspace(
  sandbox: ExtensionSandbox,
  fixtureServer: FixtureServer,
  proposalDelay = 0,
) {
  const { context, popup } = await sandbox.launch();
  const article = await context.newPage();
  await article.goto(fixtureServer.origin + '/article');
  await article.evaluate(() => {
    document.title = '<img src=x onerror=alert(1)> Research';
  });
  const reader = await context.newPage();
  await reader.goto(fixtureServer.origin + '/long');
  const host = await context.newPage();
  const session = 'a'.repeat(16);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    if (name === 'saul_sessions') return { sessions: [{ session, extensionId: 'b'.repeat(32) }] };
    const params = { ...args };
    delete params.session;
    return popup.evaluate(
      async ({ name, params }) => {
        const fixture = await import(
          /* @vite-ignore */ chrome.runtime.getURL('browser-tools-fixture.js')
        );
        return fixture.handleTabCall(name, params);
      },
      { name, params },
    );
  };
  const workspace = createWorkspace({ call });
  const messages: unknown[] = [];
  await host.exposeFunction('workspaceCall', async (name: string, args: unknown) => {
    if (name === 'saul_workspace_propose' && proposalDelay)
      await new Promise((resolve) => setTimeout(resolve, proposalDelay));
    return workspace(name, args);
  });
  await host.exposeFunction('recordMessage', (message: unknown) => {
    messages.push(message);
  });
  const html = (await readFile('native/ui/workspace.html', 'utf8'))
    .replace('/* SAUL_STYLE */', () => '')
    .replace('/* SAUL_SCRIPT */', () => '');
  const css =
    (await readFile('native/ui/design-tokens.css', 'utf8')) +
    '\n' +
    (await readFile('native/ui/workspace.css', 'utf8'));
  const js = await readFile('native/ui/workspace.js', 'utf8');
  await host.route('**/saul-app', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>MCP App host fixture</title><iframe title="Saul workspace" style="width:100%;height:900px;border:0"></iframe>',
    }),
  );
  await host.goto(fixtureServer.origin + '/saul-app');
  await host.evaluate(() => {
    const runtime = window as typeof window & {
      workspaceCall: (name: string, args: unknown) => Promise<unknown>;
      recordMessage: (message: unknown) => Promise<void>;
    };
    window.addEventListener('message', async (event) => {
      if (event.source !== document.querySelector('iframe')!.contentWindow) return;
      const message = event.data;
      if (message.id === undefined) return;
      let result: unknown = {};
      try {
        if (message.method === 'ui/initialize')
          result = {
            protocolVersion: '2026-01-26',
            hostCapabilities: { message: {} },
            hostContext: { theme: 'light' },
          };
        if (message.method === 'tools/call')
          result = await runtime.workspaceCall(message.params.name, message.params.arguments);
        if (message.method === 'ui/message') await runtime.recordMessage(message.params);
        event.source!.postMessage(
          { jsonrpc: '2.0', id: message.id, result },
          { targetOrigin: '*' },
        );
      } catch (error) {
        event.source!.postMessage(
          { jsonrpc: '2.0', id: message.id, error: { message: String(error) } },
          { targetOrigin: '*' },
        );
      }
    });
  });
  await host.locator('iframe').evaluate(
    (iframe, content) => {
      (iframe as HTMLIFrameElement).srcdoc = content;
    },
    html
      .replace('</head>', `<style>${css}</style></head>`)
      .replace('</body>', `<script type="module">${js}</script></body>`),
  );
  const ui = host.frameLocator('iframe');
  await expect(ui.getByRole('heading', { name: 'Tabs', exact: true })).toBeVisible();
  await expect(ui.locator('#board')).toContainText('<img src=x onerror=alert(1)> Research');
  await expect(ui.locator('#board img')).toHaveCount(0);
  return { ui, host, context, popup, call, workspace, session, messages, article, reader };
}

test('MCP App renders real tabs, sends a Codex request and applies only after its review button', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { ui, host, call, workspace, session, messages, article, reader } = await openWorkspace(
    sandbox,
    fixtureServer,
  );
  await ui.locator('#composer > summary').click();
  await ui
    .getByRole('textbox', { name: 'How would you like' })
    .fill('Put research and reading in a new window');
  await ui.getByRole('button', { name: 'Ask Codex' }).click();
  await expect.poll(() => JSON.stringify(messages)).toContain('saul_workspace_propose');
  const before = (await call('saul_tabs_list')) as TabSnapshot;
  const chosen = before.tabs
    .filter((t) => t.url === article.url() || t.url === reader.url())
    .map((t) => t.id);
  const plan = await workspace('saul_workspace_propose', {
    session,
    revision: revision(before),
    summary: 'Keep the working window; collect reading into its own window.',
    windows: [
      {
        windowId: before.tabs.find((t) => t.id === chosen[0])!.windowId,
        title: 'Working window',
        tabIds: before.tabs.filter((t) => !chosen.includes(t.id)).map((t) => t.id),
      },
      { title: 'Research & reading', tabIds: chosen },
    ],
  });
  await host.evaluate(
    (result) =>
      document
        .querySelector('iframe')!
        .contentWindow!.postMessage(
          { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: result },
          '*',
        ),
    plan,
  );
  await expect(ui.getByRole('heading', { name: 'Ready for your review' })).toBeVisible();
  await expect(ui.getByRole('heading', { name: 'Research & reading' })).toBeVisible();
  await ui.getByRole('button', { name: 'Rename window: Research & reading', exact: true }).click();
  await ui.getByRole('textbox', { name: 'Window label', exact: true }).fill('Reading library');
  await ui.getByRole('textbox', { name: 'Window label', exact: true }).press('Enter');
  await expect(ui.getByRole('heading', { name: 'Reading library', exact: true })).toBeVisible();
  expect(revision((await call('saul_tabs_list')) as TabSnapshot)).toBe(revision(before));
  await captureWorkspace(host, ui, info.outputPath('workspace-preview.png'));
  await ui.getByRole('button', { name: 'Apply changes to Chrome' }).click();
  await expect(ui.getByRole('heading', { name: 'Proposal applied' })).toBeVisible();
  await expect(ui.getByRole('heading', { name: 'Reading library', exact: true })).toBeVisible();
  await ui.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(ui.getByRole('heading', { name: 'Reading library', exact: true })).toBeVisible();
  await expect(ui.getByRole('button', { name: 'Apply changes to Chrome' })).toBeDisabled();
  const after = (await call('saul_tabs_list')) as TabSnapshot;
  expect(after.tabs.map((t) => t.id).sort()).toEqual(before.tabs.map((t) => t.id).sort());
  const moved = after.tabs.filter((t) => chosen.includes(t.id));
  expect(new Set(moved.map((t) => t.windowId)).size).toBe(1);
  expect(moved[0]!.windowId).not.toBe(before.tabs.find((t) => t.id === chosen[0])!.windowId);
  expect(moved.sort((a, b) => a.index - b.index).map((t) => t.id)).toEqual(chosen);
  await host.setViewportSize({ width: 390, height: 850 });
  await expect(ui.locator('body')).toBeVisible();
  expect(await ui.locator('body').evaluate((body) => body.scrollWidth <= innerWidth)).toBe(true);
});

test('drag and keyboard moves compose a reviewed layout without changing Chrome until apply', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { ui, host, popup, call, article, reader } = await openWorkspace(sandbox, fixtureServer);
  const pinned = await host.context().newPage();
  await pinned.goto(fixtureServer.origin + '/article#pinned');
  const grouped = await host.context().newPage();
  await grouped.goto(fixtureServer.origin + '/article#grouped');
  let before = (await call('saul_tabs_list')) as TabSnapshot;
  const pinnedId = before.tabs.find((tab) => tab.url === pinned.url())!.id;
  const groupedId = before.tabs.find((tab) => tab.url === grouped.url())!.id;
  await popup.evaluate(
    async ({ pinnedId, groupedId }) => {
      await chrome.tabs.update(pinnedId, { pinned: true });
      const groupId = await chrome.tabs.group({ tabIds: [groupedId] });
      await chrome.tabGroups.update(groupId, { title: 'Keep together', color: 'blue' });
    },
    { pinnedId, groupedId },
  );
  await ui.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(ui.locator('.tag').filter({ hasText: 'Keep together' })).toBeVisible();
  before = (await call('saul_tabs_list')) as TabSnapshot;
  const articleId = before.tabs.find((tab) => tab.url === article.url())!.id;
  const readerId = before.tabs.find((tab) => tab.url === reader.url())!.id;
  const originalWindow = before.tabs.find((tab) => tab.id === articleId)!.windowId;
  const tab = (id: number) => ui.locator(`[data-tab-id="${id}"]`);
  await expect(tab(pinnedId)).toHaveAttribute('draggable', 'false');
  await expect(tab(groupedId)).toHaveAttribute('draggable', 'false');
  await expect(tab(pinnedId).getByRole('button')).toHaveCount(0);
  // Embedded WebViews may not dispatch HTML5 drag events. Exercise pointer dragging
  // with native dragstart blocked, and deliver a refresh result while holding the tab.
  await ui.locator('body').evaluate((body) => {
    body.addEventListener('dragstart', (event) => event.preventDefault(), true);
  });
  await tab(readerId).dragTo(tab(articleId), { targetPosition: { x: 60, y: 5 } });
  await expect(ui.getByRole('heading', { name: 'Ready for your review' })).toBeVisible();
  const ids = async (selector: string) =>
    ui
      .locator(selector)
      .evaluateAll((items) => items.map((item) => Number((item as HTMLElement).dataset.tabId)));
  expect((await ids('.tab')).indexOf(readerId)).toBeLessThan(
    (await ids('.tab')).indexOf(articleId),
  );
  expect(revision((await call('saul_tabs_list')) as TabSnapshot)).toBe(revision(before));
  // Keyboard/touch controls edit the same proposal and preserve all hidden tabs when filtered.
  await tab(readerId).getByRole('button').focus();
  await tab(readerId).getByRole('button').press('Enter');
  await expect(ui.getByRole('combobox', { name: 'Destination window' })).toBeFocused();
  await ui.getByRole('button', { name: 'Move down', exact: true }).press('Enter');
  await expect(ui.locator('#status')).toContainText('Preview updated');
  expect((await ids('.tab')).indexOf(articleId)).toBeLessThan(
    (await ids('.tab')).indexOf(readerId),
  );
  await ui.getByRole('button', { name: 'Done', exact: true }).click();
  await ui.getByRole('searchbox', { name: 'Filter tabs' }).fill('Research');
  await tab(articleId).dragTo(ui.locator('#new-window'));
  await expect(ui.getByRole('heading', { name: 'New window', exact: true })).toBeVisible();
  await ui.getByRole('searchbox', { name: 'Filter tabs' }).fill('');
  const newCard = ui
    .locator('.window')
    .filter({ has: ui.getByRole('heading', { name: 'New window', exact: true }) });
  await tab(readerId).dragTo(newCard.locator('.window-end'));
  await expect(newCard.locator('.tab')).toHaveCount(2);
  expect(await ids('.window:has(h2:text-is("New window")) .tab')).toEqual([articleId, readerId]);
  await tab(readerId).scrollIntoViewIfNeeded();
  const from = (await tab(readerId).boundingBox())!;
  const to = (await tab(articleId).boundingBox())!;
  await host.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await host.mouse.down();
  await host.mouse.move(to.x + to.width / 2, to.y + 5, { steps: 8 });
  const refreshed = await host.evaluate(async () => {
    const runtime = window as typeof window & { workspaceCall: (name: string) => Promise<unknown> };
    return runtime.workspaceCall('saul_workspace_state');
  });
  await host.evaluate(
    (result) =>
      document
        .querySelector('iframe')!
        .contentWindow!.postMessage(
          { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: result },
          '*',
        ),
    refreshed,
  );
  await host.mouse.up();
  await expect
    .poll(() => ids('.window:has(h2:text-is("New window")) .tab'))
    .toEqual([readerId, articleId]);
  await tab(articleId).dragTo(tab(readerId), { targetPosition: { x: 60, y: 5 } });
  await expect
    .poll(() => ids('.window:has(h2:text-is("New window")) .tab'))
    .toEqual([articleId, readerId]);
  expect(revision((await call('saul_tabs_list')) as TabSnapshot)).toBe(revision(before));
  // Return a tab to an existing window, then restore the intended two-tab window.
  await tab(readerId).getByRole('button').click();
  await ui
    .getByRole('combobox', { name: 'Destination window' })
    .selectOption(String(originalWindow));
  await ui.getByRole('button', { name: 'Move to end', exact: true }).click();
  await expect(newCard.locator('.tab')).toHaveCount(1);
  await ui.getByRole('button', { name: 'Done', exact: true }).click();
  await tab(readerId).dragTo(newCard.locator('.window-end'));
  await expect(newCard.locator('.tab')).toHaveCount(2);
  await captureWorkspace(host, ui, info.outputPath('drag-preview.png'));
  await ui.getByRole('button', { name: 'Apply changes to Chrome' }).click();
  await expect(ui.getByRole('heading', { name: 'Proposal applied' })).toBeVisible();
  const after = (await call('saul_tabs_list')) as TabSnapshot;
  expect(after.tabs.map((tab) => tab.id).sort()).toEqual(before.tabs.map((tab) => tab.id).sort());
  const movedWindow = after.tabs.find((tab) => tab.id === articleId)!.windowId;
  expect(movedWindow).not.toBe(originalWindow);
  expect(
    after.tabs
      .filter((tab) => tab.windowId === movedWindow)
      .sort((a, b) => a.index - b.index)
      .map((tab) => tab.id),
  ).toEqual([articleId, readerId]);
  expect(after.tabs.find((tab) => tab.id === pinnedId)).toMatchObject({
    pinned: true,
    windowId: originalWindow,
  });
  expect(after.groups).toEqual(before.groups);
  // An external layout change invalidates the preview and cannot be applied.
  await tab(readerId).dragTo(tab(articleId), { targetPosition: { x: 60, y: 5 } });
  await expect(ui.getByRole('heading', { name: 'Ready for your review' })).toBeVisible();
  const external = await host.context().newPage();
  await external.goto(fixtureServer.origin + '/article#external');
  await ui.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(ui.getByRole('heading', { name: 'Proposal stale' })).toBeVisible();
  await expect(ui.locator('#proposal')).toContainText('This preview is out of date.');
  await expect(ui.getByRole('button', { name: 'Apply changes to Chrome' })).toBeDisabled();
  await expect(tab(articleId)).toHaveAttribute('draggable', 'false');
  await host.setViewportSize({ width: 390, height: 850 });
  expect(await ui.locator('body').evaluate((body) => body.scrollWidth <= innerWidth)).toBe(true);
  await captureWorkspace(host, ui, info.outputPath('drag-mobile.png'));
  await host.evaluate(() =>
    document.querySelector('iframe')!.contentWindow!.postMessage(
      {
        jsonrpc: '2.0',
        method: 'ui/notifications/host-context-changed',
        params: { theme: 'dark' },
      },
      '*',
    ),
  );
  await expect(ui.locator('html')).toHaveAttribute('data-theme', 'dark');
  await captureWorkspace(host, ui, info.outputPath('drag-dark.png'));
});

test('drag feedback follows the pointer, scrolls while held and composes immediate moves with slow preview responses', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { ui, host, popup, call, article, reader } = await openWorkspace(
    sandbox,
    fixtureServer,
    1200,
  );
  await host.setViewportSize({ width: 1100, height: 1300 });
  await host.locator('iframe').evaluate((node) => {
    node.style.height = '1200px';
  });
  const destinationId = await popup.evaluate(async (origin) => {
    const current = await chrome.windows.getCurrent();
    for (let i = 0; i < 25; i++)
      await chrome.tabs.create({
        windowId: current.id,
        url: `${origin}/article#reading-${i}`,
        active: false,
      });
    return (await chrome.windows.create({ url: `${origin}/article#destination`, focused: false }))!
      .id!;
  }, fixtureServer.origin);
  await ui.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(ui.locator(`.window[data-window-id="${destinationId}"]`)).toBeVisible();
  const before = (await call('saul_tabs_list')) as TabSnapshot;
  const articleId = before.tabs.find((tab) => tab.url === article.url())!.id;
  const readerId = before.tabs.find((tab) => tab.url === reader.url())!.id;
  const originId = before.tabs.find((tab) => tab.id === articleId)!.windowId;
  const row = (id: number) => ui.locator(`[data-tab-id="${id}"]`);
  const sourceCard = ui.locator(`.window[data-window-id="${originId}"]`);
  const targetCard = ui.locator(`.window[data-window-id="${destinationId}"]`);
  await row(articleId).scrollIntoViewIfNeeded();
  const start = (await row(articleId).boundingBox())!;
  const viewport = (await sourceCard.locator('.tabs').boundingBox())!;
  await host.mouse.move(start.x + 70, start.y + 12);
  await host.mouse.down();
  await host.mouse.move(start.x + 90, viewport.y + viewport.height - 12, { steps: 8 });
  await expect(ui.locator('.drag-ghost')).toBeVisible();
  await expect(ui.locator('.drag-destination')).toContainText('Window 1');
  await expect(ui.locator('.drop-indicator')).toBeVisible();
  const scroll = await sourceCard.locator('.tabs').evaluate((list) => list.scrollTop);
  // No additional pointer movements: a stationary edge hover must keep scrolling.
  await expect
    .poll(() => sourceCard.locator('.tabs').evaluate((list) => list.scrollTop))
    .toBeGreaterThan(scroll + 30);
  await host.screenshot({ path: info.outputPath('smooth-drag-held.png'), fullPage: true });
  await host.keyboard.press('Escape');
  await host.mouse.up();
  await expect(ui.locator('.drag-ghost')).toHaveCount(0);
  await expect(ui.locator('.drop-indicator')).toHaveCount(0);
  expect(revision((await call('saul_tabs_list')) as TabSnapshot)).toBe(revision(before));
  await sourceCard.locator('.tabs').evaluate((list) => {
    list.scrollTop = 0;
  });
  await row(articleId).dragTo(targetCard.locator('.window-end'));
  // The row is placed immediately while the host is still validating the preview.
  await expect(targetCard.locator(`[data-tab-id="${articleId}"]`)).toBeVisible();
  await expect(ui.getByRole('button', { name: 'Apply changes to Chrome' })).toBeDisabled();
  const targetRow = row(articleId);
  const end = (await targetRow.boundingBox())!;
  await row(readerId).dragTo(targetRow, { targetPosition: { x: 60, y: end.height - 5 } });
  await expect(targetCard.locator('.tab')).toHaveCount(3);
  await expect(ui.getByRole('button', { name: 'Apply changes to Chrome' })).toBeEnabled();
  const finalIds = await targetCard
    .locator('.tab')
    .evaluateAll((nodes) => nodes.map((node) => Number((node as HTMLElement).dataset.tabId)));
  expect(finalIds.slice(-2)).toEqual([articleId, readerId]);
  expect(revision((await call('saul_tabs_list')) as TabSnapshot)).toBe(revision(before));
  await captureWorkspace(host, ui, info.outputPath('smooth-drag-preview.png'));
});

test('compact board keeps tab controls discoverable and cancels rename and move with Escape', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { ui, host, popup, call, article } = await openWorkspace(sandbox, fixtureServer);
  await host.setViewportSize({ width: 1100, height: 900 });
  const windowIds = await popup.evaluate(async (origin) => {
    const ids: number[] = [];
    for (let w = 0; w < 2; w++) {
      const window = await chrome.windows.create({
        url: `${origin}/article#window-${w}`,
        focused: false,
      });
      ids.push(window!.id!);
      for (let i = 0; i < 10; i++)
        await chrome.tabs.create({
          windowId: window!.id!,
          url: `${origin}/article#reading-${w}-${i}`,
          active: false,
        });
    }
    return ids;
  }, fixtureServer.origin);
  await ui.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(ui.locator('.window')).toHaveCount(3);
  await expect(ui.getByRole('combobox', { name: 'Browser session' })).toBeHidden();
  await expect(ui.getByRole('textbox', { name: 'How would you like' })).toBeHidden();
  await expect(ui.locator('html')).toHaveAttribute('data-minimum', 'true');
  await expect(ui.locator('.help.guidance')).toBeHidden();
  expect(
    await ui.locator('#board').evaluate((board) => board.getBoundingClientRect().top),
  ).toBeLessThan(280);
  const before = (await call('saul_tabs_list')) as TabSnapshot;
  const articleId = before.tabs.find((tab) => tab.url === article.url())!.id;
  const rename = ui.getByRole('button', { name: 'Rename window: Window 1', exact: true });
  await rename.click();
  await ui.getByRole('textbox', { name: 'Window label', exact: true }).fill('Discard this edit');
  await ui.getByRole('textbox', { name: 'Window label', exact: true }).press('Escape');
  await expect(ui.getByRole('textbox', { name: 'Window label', exact: true })).toHaveCount(0);
  await expect(rename).toBeFocused();
  await rename.click();
  await ui.getByRole('textbox', { name: 'Window label', exact: true }).press('Enter');
  await expect(ui.getByRole('textbox', { name: 'Window label', exact: true })).toHaveCount(0);
  await expect(ui.locator('#proposal')).toBeHidden();
  const untouched = ui.locator(`.window[data-window-id="${windowIds[0]}"]`);
  const originalNode = await untouched.elementHandle();
  const scrollTop = await untouched.locator('.tabs').evaluate((list) => {
    list.scrollTop = 140;
    return list.scrollTop;
  });
  expect(scrollTop).toBeGreaterThan(0);
  const handle = ui.locator(`[data-tab-id="${articleId}"] .move-handle`);
  await handle.click();
  await expect(ui.getByRole('combobox', { name: 'Destination window' })).toBeFocused();
  expect(await originalNode!.evaluate((node) => node.isConnected)).toBe(true);
  expect(await untouched.locator('.tabs').evaluate((list) => list.scrollTop)).toBe(scrollTop);
  await ui.getByRole('combobox', { name: 'Destination window' }).press('Escape');
  await expect(ui.locator('#move-controls')).toBeHidden();
  await expect(handle).toBeFocused();
  expect(revision((await call('saul_tabs_list')) as TabSnapshot)).toBe(revision(before));
  await ui.getByText('View options', { exact: true }).click();
  const minimumMode = ui.getByRole('checkbox', { name: 'Minimum Mode', exact: true });
  await expect(minimumMode).toBeChecked();
  await minimumMode.uncheck();
  await expect(ui.locator('.help.guidance')).toBeVisible();
  // Reopening the embedded view restores presentation without changing Chrome.
  await host.locator('iframe').evaluate((frame) => {
    const iframe = frame as HTMLIFrameElement;
    const markup = iframe.srcdoc;
    iframe.srcdoc = markup;
  });
  await expect(ui.locator('html')).toHaveAttribute('data-minimum', 'false');
  await expect(ui.locator('.window')).toHaveCount(3);
  expect(revision((await call('saul_tabs_list')) as TabSnapshot)).toBe(revision(before));
  await ui.getByText('View options', { exact: true }).click();
  await minimumMode.check();
  await ui.getByText('View options', { exact: true }).click();
  await captureWorkspace(host, ui, info.outputPath('board-light.png'));
  await host.evaluate(() =>
    document.querySelector('iframe')!.contentWindow!.postMessage(
      {
        jsonrpc: '2.0',
        method: 'ui/notifications/host-context-changed',
        params: { theme: 'dark' },
      },
      '*',
    ),
  );
  await expect(ui.locator('html')).toHaveAttribute('data-theme', 'dark');
  await captureWorkspace(host, ui, info.outputPath('board-dark.png'));
  await ui.locator('#composer > summary').focus();
  await ui.locator('#composer > summary').press('Enter');
  await expect(ui.getByRole('textbox', { name: 'How would you like' })).toBeVisible();
  await ui.locator('#composer > summary').press('Enter');
  await host.setViewportSize({ width: 390, height: 850 });
  expect(await ui.locator('body').evaluate((body) => body.scrollWidth <= innerWidth)).toBe(true);
  await captureWorkspace(host, ui, info.outputPath('board-mobile.png'));
});
