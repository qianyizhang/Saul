import { test, expect } from './fixtures.ts';
import type { Page } from '@playwright/test';
import type { ToolArgs, ToolName, ToolResults } from '../../native/protocol.mjs';

test.use({ browserToolsFixtures: true });

function call<K extends ToolName>(
  popup: Page,
  name: K,
  args: ToolArgs[K],
): Promise<ToolResults[K]> {
  return popup.evaluate(
    async ({ name, args }) => {
      const url = chrome.runtime.getURL('browser-tools-fixture.js');
      const fixture = await import(/* @vite-ignore */ url);
      return fixture.handleTabCall(name, args);
    },
    { name, args },
  );
}

test('page access is opt-in; reads, previews, fills, clicks and navigation reject stale references', async ({
  sandbox,
  fixtureServer,
}) => {
  const { context, popup } = await sandbox.launch();
  const page = await context.newPage();
  await page.goto(fixtureServer.origin + '/article');
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<label>Name<input id="name" value="private-existing-value"></label><input type="password" value="secret"><button id="save">Save locally</button><p id="result"></p>',
    );
    document.querySelector('#save')!.addEventListener('click', () => {
      document.querySelector('#result')!.textContent = (
        document.querySelector('#name') as HTMLInputElement
      ).value;
    });
  });
  const inventory = await call(popup, 'saul_tabs_list', {});
  const tabId = inventory.tabs.find((tab) => tab.url === page.url())!.id;
  await expect(call(popup, 'saul_page_read', { tabId })).rejects.toThrow('Enable Page reading');
  await popup.goto(popup.url().replace('popup.html', 'library.html') + '#settings');
  await popup.getByText('Codex connection', { exact: true }).click();
  await popup.getByRole('checkbox', { name: 'Page reading and actions' }).check();
  let read = await call(popup, 'saul_page_read', { tabId });
  expect(read.text).toContain('Gradient descent');
  expect(JSON.stringify(read)).not.toContain('private-existing-value');
  expect(JSON.stringify(read)).not.toContain('secret');
  const field = read.elements.find((e) => e.label === 'Name')!;
  const fill = {
    tabId,
    documentId: read.documentId,
    snapshotId: read.snapshotId,
    elementId: field.elementId,
    action: 'fill' as const,
    value: 'Ada',
  };
  expect(await call(popup, 'saul_page_act', fill)).toMatchObject({ dryRun: true });
  await expect(page.locator('#name')).toHaveValue('private-existing-value');
  await call(popup, 'saul_page_act', { ...fill, dryRun: false });
  await expect(page.locator('#name')).toHaveValue('Ada');
  await expect(call(popup, 'saul_page_act', { ...fill, dryRun: false })).rejects.toThrow();
  read = await call(popup, 'saul_page_read', { tabId });
  const password = read.elements.find((e) => e.type === 'password')!;
  await expect(
    call(popup, 'saul_page_act', {
      ...fill,
      snapshotId: read.snapshotId,
      elementId: password.elementId,
    }),
  ).rejects.toThrow();
  const click = {
    tabId,
    documentId: read.documentId,
    snapshotId: read.snapshotId,
    elementId: read.elements.find((e) => e.label === 'Save locally')!.elementId,
    action: 'click' as const,
  };
  await call(popup, 'saul_page_act', click);
  await expect(page.locator('#result')).toHaveText('');
  await call(popup, 'saul_page_act', { ...click, dryRun: false });
  await expect(page.locator('#result')).toHaveText('Ada');
  read = await call(popup, 'saul_page_read', { tabId });
  await page.locator('#save').evaluate((button) => (button.textContent = 'Changed'));
  await expect(
    call(popup, 'saul_page_act', { ...click, snapshotId: read.snapshotId, dryRun: false }),
  ).rejects.toThrow();
  const nav = { tabId, expectedUrl: page.url(), url: fixtureServer.origin + '/anchors' };
  await call(popup, 'saul_page_navigate', nav);
  expect(page.url()).toBe(nav.expectedUrl);
  await expect(
    call(popup, 'saul_page_navigate', { ...nav, url: 'javascript:alert(1)', dryRun: false }),
  ).rejects.toThrow('HTTP(S)');
  await call(popup, 'saul_page_navigate', { ...nav, dryRun: false });
  await expect(page).toHaveURL(nav.url);
  await expect(call(popup, 'saul_page_act', { ...click, dryRun: false })).rejects.toThrow();
  await expect(call(popup, 'saul_page_navigate', { ...nav, dryRun: false })).rejects.toThrow(
    'URL changed',
  );
  await popup.getByRole('checkbox', { name: 'Page reading and actions' }).uncheck();
  await expect(call(popup, 'saul_page_read', { tabId })).rejects.toThrow('Enable Page reading');
});

test('new windows preserve tab IDs and order; internal pages reject content access', async ({
  sandbox,
  fixtureServer,
}) => {
  const { context, popup } = await sandbox.launch();
  for (const route of ['/article', '/anchors']) {
    const page = await context.newPage();
    await page.goto(fixtureServer.origin + route);
  }
  const before = await call(popup, 'saul_tabs_list', {});
  const tabIds = before.tabs
    .filter((tab) => tab.url.startsWith(fixtureServer.origin))
    .map((tab) => tab.id)
    .reverse();
  await call(popup, 'saul_windows_create', { tabIds });
  expect((await call(popup, 'saul_tabs_list', {})).windows).toHaveLength(before.windows.length);
  const moved = await call(popup, 'saul_windows_create', { tabIds, dryRun: false });
  const after = await call(popup, 'saul_tabs_list', {});
  expect(after.tabs.map((tab) => tab.id).sort()).toEqual(before.tabs.map((tab) => tab.id).sort());
  expect(after.tabs.filter((tab) => tab.windowId === moved.windowId).map((tab) => tab.id)).toEqual(
    tabIds,
  );
  await popup.evaluate(() => chrome.storage.local.set({ saul_native_page_enabled: true }));
  const internal = after.tabs.find((tab) => tab.url.startsWith('chrome-extension:'))!;
  await expect(call(popup, 'saul_page_read', { tabId: internal.id })).rejects.toThrow();
});

test('production native bridge dispatches page tools through its built background', async ({
  sandbox,
  fixtureServer,
}) => {
  const { context, popup, worker } = await sandbox.launch();
  const page = await context.newPage();
  await page.goto(fixtureServer.origin + '/article');
  await worker.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      nativeMessage?: (message: unknown) => void;
      nativeReply?: (message: unknown) => void;
    };
    chrome.runtime.connectNative = (() => ({
      onMessage: {
        addListener: (listener: (message: unknown) => void) => {
          state.nativeMessage = listener;
        },
      },
      onDisconnect: { addListener: () => {} },
      postMessage: (message: unknown) => state.nativeReply?.(message),
      disconnect: () => {},
    })) as unknown as typeof chrome.runtime.connectNative;
  });
  await popup.evaluate(() =>
    chrome.storage.local.set({ saul_native_enabled: true, saul_native_page_enabled: true }),
  );
  await expect
    .poll(() =>
      worker.evaluate(() =>
        Boolean((globalThis as typeof globalThis & { nativeMessage?: unknown }).nativeMessage),
      ),
    )
    .toBe(true);
  const tabId = (await call(popup, 'saul_tabs_list', {})).tabs.find(
    (tab) => tab.url === page.url(),
  )!.id;
  const result = await worker.evaluate(async (tabId) => {
    const state = globalThis as typeof globalThis & {
      nativeMessage: (message: unknown) => void;
      nativeReply: (message: {
        result?: ToolResults['saul_page_read'];
        error?: { message: string };
      }) => void;
    };
    return new Promise<ToolResults['saul_page_read']>((resolve, reject) => {
      state.nativeReply = (message) =>
        message.error ? reject(new Error(message.error.message)) : resolve(message.result!);
      state.nativeMessage({ id: 'read-production', method: 'saul_page_read', params: { tabId } });
    });
  }, tabId);
  expect(result.text).toContain('Gradient descent');
  expect(result.documentId).toBeTruthy();
});
