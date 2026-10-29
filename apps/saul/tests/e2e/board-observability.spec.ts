import { test, expect } from './fixtures.ts';
import { openWorkspace, matchWorkspaceWindow } from './workspace-fixture.ts';
import { startBoardWeb } from '../../.build/native/board-http.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
test.use({ browserToolsFixtures: true });
test('live board exposes exact send, catalog, metadata health and a scoped capture', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { ui, host, messages, service } = await openWorkspace(sandbox, fixtureServer);
  await ui.getByRole('button', { name: 'App info', exact: true }).click();
  const dialog = ui.getByRole('dialog');
  await expect(dialog).toContainText('Metadata on disk');
  await dialog.getByRole('button', { name: 'Tools', exact: true }).click();
  await expect(dialog).toContainText(`${service.tools.length} tools from the active server`);
  await expect(dialog.getByText('saul_workspace_apply', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Conversation flow', exact: true }).click();
  await expect(dialog).toContainText('No automatic evidence read');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await ui.locator('#composer > summary').click();
  await ui.locator('#request').fill('hi — scoped Saul diagnostic fixture');
  await ui.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(ui.locator('#send-status')).toContainText('Accepted by host');
  expect(messages).toEqual([
    { role: 'user', content: [{ type: 'text', text: 'hi — scoped Saul diagnostic fixture' }] },
  ]);
  // Inventory refresh must not erase message delivery evidence.
  await ui.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(ui.locator('#send-status')).toContainText('Accepted by host');
  await ui.locator('#composer > summary').click();
  await ui.getByRole('button', { name: 'Inspect send', exact: true }).click();
  await dialog.getByRole('button', { name: /ui\/message · request/ }).click();
  await expect(dialog.locator('pre')).toContainText('hi — scoped Saul diagnostic fixture');
  await expect(dialog.locator('pre')).not.toContainText('selectedTabIds');
  await dialog.getByRole('button', { name: 'Save diagnostic capture', exact: true }).click();
  await expect(dialog).toContainText('Saved 2 observations');
  const captures = readdirSync(service.store.directory).filter((name) =>
    name.startsWith('capture-'),
  );
  expect(captures).toHaveLength(1);
  const captured = JSON.parse(readFileSync(join(service.store.directory, captures[0]!), 'utf8'));
  expect(new Set(captured.events.map((e: { interaction: string }) => e.interaction)).size).toBe(1);
  expect(readFileSync(join(service.store.directory, 'app.jsonl'), 'utf8')).not.toContain(
    'scoped Saul diagnostic fixture',
  );
  await host.setViewportSize({ width: 390, height: 850 });
  await matchWorkspaceWindow(host);
  await host.evaluate(() => window.fixtureHost.theme('dark'));
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await host.screenshot({
    path: info.outputPath('saul-observability-dark-narrow.png'),
    fullPage: true,
  });
});
test('standalone board edits real fixture tabs, copies a draft and inspects HTTP boundaries without a host', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { context, service, call } = await openWorkspace(sandbox, fixtureServer);
  const local = await startBoardWeb({ service });
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: local.origin });
    const page = await context.newPage();
    await page.goto(local.url);
    await matchWorkspaceWindow(page);
    await expect(page.locator('.tab-title').filter({ hasText: /^Research$/ })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Select Research', exact: true }).check();
    await page.getByRole('button', { name: 'Group', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Group name', exact: true })
      .fill('Standalone fixture group');
    await page.getByRole('button', { name: 'Create group', exact: true }).click();
    await expect
      .poll(async () =>
        (await call('saul_tabs_list')).groups.some(
          (group) => group.title === 'Standalone fixture group',
        ),
      )
      .toBe(true);
    await page.locator('#composer > summary').click();
    await page.locator('#request').fill('hi standalone');
    await page.getByRole('button', { name: 'Copy message', exact: true }).click();
    await expect(page.locator('#send-status')).toContainText('Copied message');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('hi standalone');
    await expect(page.locator('#request')).toHaveValue('hi standalone');
    await page.getByRole('button', { name: 'App info', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('standalone');
    await expect(page.getByRole('dialog')).toContainText(service.store.instance);
    await page.getByRole('button', { name: 'Interactions', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('saul_workspace_edit');
    await page.screenshot({
      path: info.outputPath('saul-standalone-observability.png'),
      fullPage: true,
    });
    await page.close();
  } finally {
    await new Promise<void>((resolve) => local.server.close(() => resolve()));
  }
});
