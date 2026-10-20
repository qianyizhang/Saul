import { expect } from './fixtures.ts';
import type { FrameLocator, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createWorkspace } from '../../native/workspace.mjs';
import {
  createWindowNames,
  withWindowNames,
  type WindowNames,
} from '../../native/window-names.mjs';
import type { TabSnapshot } from '../../native/protocol.mjs';
import type { ExtensionSandbox, FixtureServer } from './support.ts';

export async function captureWorkspace(host: Page, ui: FrameLocator, path: string) {
  // Expand the fixture frame for an uncropped capture; do not alter app styles or controls.
  const height = await ui.locator('body').evaluate(() => {
    window.scrollTo(0, 0);
    return document.documentElement.scrollHeight;
  });
  const frame = host.locator('iframe');
  await frame.evaluate((node, height) => {
    node.style.height = `${height}px`;
  }, height);
  await ui.locator('body').evaluate(() => window.scrollTo(0, 0));
  await host.evaluate(() => window.scrollTo(0, 0));
  await host.screenshot({ path, fullPage: true });
  await frame.evaluate((node) => {
    node.style.height = '900px';
  });
}

export async function openWorkspace(
  sandbox: ExtensionSandbox,
  fixtureServer: FixtureServer,
  proposalDelay = 0,
  nativeNaming = false,
) {
  const { context, popup, worker } = await sandbox.launch();
  const article = await context.newPage();
  await article.goto(fixtureServer.origin + '/article');
  await article.evaluate(() => {
    document.title = '<img src=x onerror=alert(1)> Research';
  });
  const reader = await context.newPage();
  await reader.goto(fixtureServer.origin + '/long');
  const host = await context.newPage();
  const session = 'a'.repeat(16);
  const rawCall = async (name: string, args: Record<string, unknown> = {}) => {
    if (name === 'saul_sessions') return { sessions: [{ session, extensionId: 'b'.repeat(32) }] };
    const params = { ...args };
    delete params.session;
    return popup.evaluate(
      async ({ name, params }) => {
        if (
          ['saul_tabs_edit', 'saul_tabs_undo', 'saul_summary_open', 'saul_summary_status'].includes(
            name,
          )
        ) {
          const reply = await chrome.runtime.sendMessage({
            type: 'WORKSPACE_TABS',
            action: 'command',
            method: name,
            args: params,
          });
          if (!reply.success) throw new Error(reply.error);
          return reply.result;
        }
        const fixture = await import(
          /* @vite-ignore */ chrome.runtime.getURL('browser-tools-fixture.js')
        );
        return fixture.handleTabCall(name, params);
      },
      { name, params },
    );
  };
  let names: WindowNames | undefined;
  if (nativeNaming) {
    const cdp = await context.browser()!.newBrowserCDPSession();
    const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
    const browserPid = processInfo.find((p) => p.type === 'browser')!.id;
    await cdp.detach();
    names = createWindowNames({ browserPid });
    const before = (await rawCall('saul_tabs_list')) as TabSnapshot;
    const native = await names.read(before);
    if (native.status !== 'available')
      throw new Error(native.message || `Native naming ${native.status}`);
    await names.apply(before, [
      { windowId: before.windows[0]!.id, title: 'Native imported reading' },
    ]);
  }
  const decorated = names ? withWindowNames(rawCall, names) : rawCall;
  const call = (name: string, args: Record<string, unknown> = {}) =>
    name === 'saul_sessions' ? rawCall(name, args) : decorated(name, args);
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
  await expect(ui.getByRole('heading', { name: 'Tab board', exact: true })).toBeVisible();
  await expect(ui.locator('#board')).toContainText('<img src=x onerror=alert(1)> Research');
  await expect(ui.locator('#board img')).toHaveCount(0);
  return {
    ui,
    worker,
    host,
    context,
    popup,
    call,
    rawCall,
    names,
    workspace,
    session,
    messages,
    article,
    reader,
  };
}
