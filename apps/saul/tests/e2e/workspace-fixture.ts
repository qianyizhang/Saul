import type { ToolName, ToolArgs } from '../../native/protocol.mts';
import { validateToolResult } from '../../native/results.mts';
import { expect } from './fixtures.ts';
import type { FrameLocator, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { BOARD_URI } from '../../.build/native/board-resource.mjs';
import { createBoardService } from '../../native/board-service.mts';
import { createWorkspace } from '../../native/workspace.mts';
import {
  createWindowNames,
  withWindowNames,
  type WindowNames,
} from '../../native/window-names.mts';
import type { TabSnapshot } from '../../native/protocol.mts';
import type { ExtensionSandbox, FixtureServer } from './support.ts';

const hostBundle = build({
  entryPoints: [fileURLToPath(new URL('./mcp-host.ts', import.meta.url))],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'silent',
}).then((result) => result.outputFiles[0]!.text);

function deliveredBoard() {
  const output = execFileSync(process.execPath, [resolve('.build/native/mcp.mjs')], {
    input:
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/read',
        params: { uri: BOARD_URI },
      }) + '\n',
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 10000,
  });
  const reply = JSON.parse(output);
  if (reply.error) throw new Error(reply.error.message);
  return reply.result.contents[0].text as string;
}

export async function matchWorkspaceWindow(host: Page) {
  // Attaching fixture tabs can reset the native window to the context's default
  // size. Opaque frames then miss real input outside that smaller hit-test area,
  // even though screenshots use the page's larger emulated viewport.
  const viewport = host.viewportSize();
  if (!viewport) throw new Error('Workspace input requires a fixed test viewport.');
  const session = await host.context().newCDPSession(host);
  try {
    const { windowId } = await session.send('Browser.getWindowForTarget');
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { left: 0, top: 0, ...viewport },
    });
  } finally {
    await session.detach();
  }
}

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
    if (name === 'saul_sessions')
      return {
        sessions: [{ session, extensionId: 'b'.repeat(32), pid: 1, connectedAt: 'fixture' }],
      };
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
  const call = async <K extends ToolName>(name: K, args?: ToolArgs[K]) =>
    validateToolResult(
      name,
      await (name === 'saul_sessions' ? rawCall(name, { ...args }) : decorated(name, { ...args })),
    );
  const workspace = createWorkspace({ call });
  const service = createBoardService({ workspace, resourceUri: BOARD_URI });
  const messages: unknown[] = [];
  const workspaceCalls: string[] = [];
  await host.exposeFunction('workspaceCall', async (name: string, args: unknown) => {
    workspaceCalls.push(name);
    if (name === 'saul_workspace_propose' && proposalDelay)
      await new Promise((resolve) => setTimeout(resolve, proposalDelay));
    return service.call(name, args);
  });
  await host.exposeFunction('recordMessage', (message: unknown) => {
    messages.push(message);
  });
  const html = deliveredBoard();
  await host.route('**/saul-app', (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: {
        'Content-Security-Policy':
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'self'",
      },
      body: '<!doctype html><title>MCP App host fixture</title><iframe title="Saul workspace" sandbox="allow-scripts" style="width:100%;height:900px;border:0"></iframe>',
    }),
  );
  await host.goto(fixtureServer.origin + '/saul-app');
  await host.addScriptTag({ content: await hostBundle });
  await host.evaluate(() => window.fixtureHost.connect());
  await host.locator('iframe').evaluate((iframe, content) => {
    (iframe as HTMLIFrameElement).srcdoc = content;
  }, html);
  const ui = host.frameLocator('iframe');
  await expect(ui.getByRole('heading', { name: 'Tab board', exact: true })).toBeVisible();
  await expect(ui.locator('.tab-title').filter({ hasText: /^Research$/ })).toHaveCount(1);
  await expect(ui.locator('#board')).not.toContainText('<img src=x onerror=alert(1)>');
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
    workspaceCalls,
    service,
    article,
    reader,
  };
}
