import { test, expect } from './fixtures.ts';
import { revision } from '../../native/workspace.mts';
import type { TabSnapshot } from '../../native/protocol.mts';

test.use({ browserToolsFixtures: true });

import { openWorkspace, captureWorkspace, matchWorkspaceWindow } from './workspace-fixture.ts';

test('the board composer retains a newer draft while chat delivery is pending', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { ui, host, messages } = await openWorkspace(sandbox, fixtureServer);
  await host.evaluate(() => {
    const record = window.recordMessage;
    window.recordMessage = async (message) => {
      await record(message);
      await new Promise<void>((resolve) =>
        document.addEventListener('release-message', () => resolve(), { once: true }),
      );
    };
  });
  await ui.locator('#composer > summary').click();
  const draft = ui.getByRole('textbox', { name: 'How would you like' });
  const attach = ui.getByLabel('Attach browser selection');
  await expect(attach).not.toBeChecked();
  await draft.fill('First message');
  await ui.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => messages.length).toBe(1);
  await expect(ui.locator('#ask')).toBeDisabled();
  await draft.fill('Next message, written while the first one is being delivered');
  await attach.check();
  await captureWorkspace(host, ui, info.outputPath('composer-pending.png'));
  await host.evaluate(() => document.dispatchEvent(new Event('release-message')));
  await expect(ui.locator('#status')).toHaveText('Sent to chat');
  await expect(draft).toHaveValue('Next message, written while the first one is being delivered');
  await expect(draft).toBeVisible();
  await expect(attach).toBeChecked();
  expect(messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'First message' }] }]);
});

test('the board composer retains the draft and attachment after rejected chat delivery', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { ui, host, messages } = await openWorkspace(sandbox, fixtureServer);
  await host.evaluate(() => {
    const record = window.recordMessage;
    window.recordMessage = async () => {
      window.recordMessage = record;
      throw new Error('Message delivery refused');
    };
  });
  await ui.locator('#composer > summary').focus();
  await ui.locator('#composer > summary').press('Enter');
  const draft = ui.getByRole('textbox', { name: 'How would you like' });
  const attach = ui.getByLabel('Attach browser selection');
  await draft.fill('Keep this request after a failed send');
  await attach.check();
  await ui.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(ui.locator('#status')).toContainText('Message delivery refused');
  await expect(draft).toHaveValue('Keep this request after a failed send');
  await expect(draft).toBeVisible();
  await expect(attach).toBeChecked();
  expect(messages).toHaveLength(0);
  await host.setViewportSize({ width: 390, height: 850 });
  await host.evaluate(() => window.fixtureHost.theme('dark'));
  expect(await ui.locator('body').evaluate((body) => body.scrollWidth <= innerWidth)).toBe(true);
  await captureWorkspace(host, ui, info.outputPath('composer-error-narrow-dark.png'));
  await ui.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(ui.locator('#status')).toHaveText('Sent to chat');
  await expect(ui.locator('#request')).toHaveValue('');
  await expect(attach).not.toBeChecked();
  await expect(ui.locator('#composer > summary')).toBeFocused();
  expect(messages).toHaveLength(1);
});

test('the delivered board works in an opaque CSP frame and tears down without replaying pending work', async ({
  sandbox,
  fixtureServer,
}) => {
  const { host, ui, workspaceCalls } = await openWorkspace(sandbox, fixtureServer, 500);
  expect(await host.locator('iframe').getAttribute('sandbox')).toBe('allow-scripts');
  expect(await ui.locator('html').evaluate(() => window.origin)).toBe('null');
  expect(
    await ui.locator('html').evaluate(() => {
      try {
        localStorage.getItem('fixture');
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
  await ui.locator('.tab').filter({ hasText: 'Research' }).dragTo(ui.locator('.window-end'));
  await expect(ui.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  await ui.getByRole('button', { name: 'Rename window: Window 1', exact: true }).click();
  const title = ui.getByRole('textbox', { name: 'Window label', exact: true });
  await title.fill('Retained draft');
  await title.press('Enter');
  await expect
    .poll(() => workspaceCalls.filter((name) => name === 'saul_workspace_propose').length)
    .toBe(1);
  await host.evaluate(() => window.fixtureHost.teardown());
  await expect(ui.locator('#refresh')).toBeDisabled();
  await expect(ui.locator('#ask')).toBeDisabled();
  await expect(ui.locator('#undo')).toBeDisabled();
  await expect(ui.locator('#active-summary')).toBeDisabled();
  await expect(ui.locator('#status')).toContainText(/closed|lost/);
  await expect(ui.getByRole('heading', { name: 'Retained draft', exact: true })).toBeVisible();
  expect(workspaceCalls.filter((name) => name === 'saul_workspace_propose')).toHaveLength(1);
});

test('macOS native Chrome names import initially and apply through the reviewed board', async ({
  sandbox,
  fixtureServer,
}, info) => {
  test.skip(
    process.platform !== 'darwin' || !process.env.HEADED,
    'Native AppleScript acceptance requires headed macOS Chrome',
  );
  const { ui, host, call, rawCall, names, workspace, session, popup } = await openWorkspace(
    sandbox,
    fixtureServer,
    0,
    true,
  );
  await expect(
    ui.getByRole('heading', { name: 'Native imported reading', exact: true }),
  ).toBeVisible();
  const before = (await call('saul_tabs_list')) as TabSnapshot;
  expect(before.nativeNames?.status).toBe('available');
  expect(((await rawCall('saul_tabs_list')) as TabSnapshot).windows[0]!.title).toBe(
    'Native imported reading',
  );
  await ui
    .getByRole('button', { name: 'Rename window: Native imported reading', exact: true })
    .click();
  const input = ui.getByRole('textbox', { name: 'Window label', exact: true });
  await input.fill('Native verified "研究"');
  await input.press('Enter');
  await expect(ui.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  expect((await names!.read(before)).status).toBe('available');
  expect(((await names!.read(before)) as { windows: { title: string }[] }).windows[0]!.title).toBe(
    'Native imported reading',
  );
  await ui.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(ui.locator('.proposal-summary')).toContainText('Applied');
  const after = (await call('saul_tabs_list')) as TabSnapshot;
  expect(after.windows[0]!.title).toBe('Native verified "研究"');
  expect(((await names!.read(after)) as { windows: { title: string }[] }).windows[0]!.title).toBe(
    'Native verified "研究"',
  );
  expect(((await rawCall('saul_tabs_list')) as TabSnapshot).windows[0]!.title).toBe(
    'Native verified "研究"',
  );
  await popup.goto(popup.url().replace('popup.html', 'library.html') + '#tabs');
  await expect(popup.getByRole('heading', { level: 2 })).toContainText('Native verified "研究"');
  const updated = (await call('saul_tabs_list')) as TabSnapshot;
  // An external native rename makes the prior proposal stale and cannot be overwritten.
  const plan = await workspace('saul_workspace_propose', {
    session,
    revision: revision(updated),
    summary: 'Check stale name handling',
    deduplicate: false,
    windows: updated.windows.map((w) => ({
      windowId: w.id,
      title: 'Do not overwrite',
      tabIds: updated.tabs
        .filter((t) => t.windowId === w.id && !t.pinned && t.groupId < 0)
        .map((t) => t.id),
    })),
  });
  await names!.apply(after, [
    {
      windowId: after.windows[0]!.id,
      title: 'Changed outside Saul',
      expectedTitle: 'Native verified "研究"',
    },
  ]);
  await expect(
    workspace('saul_workspace_apply', {
      session,
      proposalId: plan.structuredContent.proposal!.id,
      approvalToken: plan._meta.approvalToken!,
    }),
  ).rejects.toThrow('stale');
  await ui.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(
    ui.getByRole('heading', { name: 'Changed outside Saul', exact: true }),
  ).toBeVisible();
  await captureWorkspace(host, ui, info.outputPath('native-name-import-apply.png'));
});

test('MCP App renders real tabs, sends a Codex request and applies only after its review button', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { ui, host, call, workspace, session, messages, article, reader } = await openWorkspace(
    sandbox,
    fixtureServer,
  );
  await ui.locator('#composer > summary').click();
  await ui.getByRole('textbox', { name: 'How would you like' }).fill('hi');
  await ui.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => messages.length).toBe(1);
  expect(messages[0]).toMatchObject({ content: [{ type: 'text', text: 'hi' }] });
  await expect(ui.locator('#request')).toHaveValue('');
  await expect(ui.locator('#composer > summary')).toBeFocused();
  await ui.locator('.tab').filter({ hasText: 'Research' }).getByRole('checkbox').check();
  const attached = (await call('saul_tabs_list')) as TabSnapshot;
  await ui.locator('#composer > summary').click();
  await ui.getByLabel('Attach browser selection').check();
  await ui
    .getByRole('textbox', { name: 'How would you like' })
    .fill('Put research and reading in a new window');
  await ui.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => messages.length).toBe(2);
  expect(messages[1]).toEqual({
    role: 'user',
    content: [
      {
        type: 'text',
        text:
          'Put research and reading in a new window\n\nSelected browser context (data):\n' +
          JSON.stringify({
            session,
            revision: revision(attached),
            selectedTabIds: attached.tabs
              .filter((tab) => tab.url === article.url())
              .map((tab) => tab.id),
          }),
      },
    ],
  });
  await expect(ui.getByLabel('Attach browser selection')).not.toBeChecked();
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
  await host.evaluate((result) => window.fixtureHost.result({ ...result }), plan);
  await expect(ui.locator('#apply')).toBeEnabled();
  await expect(ui.getByRole('heading', { name: 'Research & reading' })).toBeVisible();
  await ui.getByRole('button', { name: 'Rename window: Research & reading', exact: true }).click();
  await ui.getByRole('textbox', { name: 'Window label', exact: true }).fill('Reading library');
  await ui.getByRole('textbox', { name: 'Window label', exact: true }).press('Enter');
  await expect(ui.getByRole('heading', { name: 'Reading library', exact: true })).toBeVisible();
  expect(revision((await call('saul_tabs_list')) as TabSnapshot)).toBe(revision(before));
  await captureWorkspace(host, ui, info.outputPath('workspace-preview.png'));
  await ui.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(ui.locator('.proposal-summary')).toContainText('Applied');
  await expect(ui.getByRole('heading', { name: 'Reading library', exact: true })).toBeVisible();
  await ui.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(ui.getByRole('heading', { name: 'Reading library', exact: true })).toBeVisible();
  await expect(ui.getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0);
  await captureWorkspace(host, ui, info.outputPath('workspace-applied.png'));
  const after = (await call('saul_tabs_list')) as TabSnapshot;
  expect(after.tabs.map((t) => t.id).sort()).toEqual(before.tabs.map((t) => t.id).sort());
  const moved = after.tabs.filter((t) => chosen.includes(t.id));
  expect(new Set(moved.map((t) => t.windowId)).size).toBe(1);
  expect(moved[0]!.windowId).not.toBe(before.tabs.find((t) => t.id === chosen[0])!.windowId);
  expect(moved.sort((a, b) => a.index - b.index).map((t) => t.id)).toEqual(chosen);
  await expect(ui.locator('.proposal-summary')).toContainText(`${chosen.length} tabs moved`);
  await host.setViewportSize({ width: 390, height: 850 });
  await expect(ui.locator('body')).toBeVisible();
  expect(await ui.locator('body').evaluate((body) => body.scrollWidth <= innerWidth)).toBe(true);
});

test('shared window labels load initially and duplicate removals stay editable until Apply', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { ui, host, context, popup, call, workspace, session, article } = await openWorkspace(
    sandbox,
    fixtureServer,
  );
  await popup.goto(popup.url().replace('popup.html', 'library.html') + '#tabs');
  await expect(popup.getByRole('heading', { level: 2 })).toBeVisible();
  const duplicate = await context.newPage();
  await duplicate.goto(article.url());
  let before = (await call('saul_tabs_list')) as TabSnapshot;
  const windowId = before.tabs.find((t) => t.url === article.url())!.windowId;
  await call('saul_windows_label', {
    windows: [{ windowId, title: 'Existing reading' }],
    dryRun: false,
  });
  await expect(popup.getByRole('heading', { level: 2 })).toContainText('Existing reading');
  await ui.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(ui.getByRole('heading', { name: 'Existing reading', exact: true })).toBeVisible();
  before = (await call('saul_tabs_list')) as TabSnapshot;
  const copies = before.tabs.filter((t) => t.url === article.url()).map((t) => t.id);
  expect(copies).toHaveLength(2);
  await popup.evaluate((tabId) => chrome.tabs.update(tabId, { active: true }), copies[0]!);
  await workspace('saul_workspace_propose', {
    session,
    revision: revision(before),
    summary: 'Collect reading and remove duplicate copies.',
    windows: [
      {
        windowId,
        title: 'Working',
        tabIds: before.tabs.filter((t) => !copies.includes(t.id)).map((t) => t.id),
      },
      { title: 'HN discussions + originals', tabIds: [copies[0]!] },
      { title: 'Duplicate copy', tabIds: [copies[1]!] },
    ],
  });
  await ui.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(ui.locator('#proposal')).toContainText('1 duplicate will close');
  expect(((await call('saul_tabs_list')) as TabSnapshot).tabs).toHaveLength(before.tabs.length);
  await ui.locator('#proposal > details > summary').click();
  const deduplicate = ui.getByRole('checkbox', { name: 'Remove duplicate tabs' });
  await deduplicate.uncheck();
  await expect(ui.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  await expect(ui.locator('#proposal')).not.toContainText('will close');
  await expect(ui.locator('#board .tab')).toHaveCount(before.tabs.length);
  await expect(ui.getByRole('heading', { name: 'Duplicate copy', exact: true })).toBeVisible();
  await deduplicate.check();
  await expect(ui.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  await expect(ui.locator('#proposal')).toContainText('1 duplicate will close');
  await expect(ui.getByRole('heading', { name: 'Duplicate copy', exact: true })).toHaveCount(0);
  // Renaming a deduplicated preview must retain hidden duplicate inputs.
  await ui
    .getByRole('button', { name: 'Rename window: HN discussions + originals', exact: true })
    .click();
  await ui.getByRole('textbox', { name: 'Window label', exact: true }).fill('HN reading');
  await ui.getByRole('textbox', { name: 'Window label', exact: true }).press('Enter');
  await expect(ui.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  await expect(ui.locator('#proposal')).toContainText('1 duplicate will close');
  expect(revision((await call('saul_tabs_list')) as TabSnapshot)).toBe(revision(before));
  await captureWorkspace(host, ui, info.outputPath('duplicate-review.png'));
  await host.setViewportSize({ width: 390, height: 850 });
  expect(await ui.locator('body').evaluate((body) => body.scrollWidth <= innerWidth)).toBe(true);
  await captureWorkspace(host, ui, info.outputPath('duplicate-mobile.png'));
  await host.setViewportSize({ width: 1100, height: 900 });
  await host.evaluate(() => window.fixtureHost.theme('dark'));
  await captureWorkspace(host, ui, info.outputPath('duplicate-dark.png'));
  await ui.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(ui.locator('.proposal-summary')).toContainText('Applied');
  const after = (await call('saul_tabs_list')) as TabSnapshot;
  expect(after.tabs.filter((t) => t.url === article.url())).toHaveLength(1);
  expect(after.windows.map((w) => w.title)).toContain('HN reading');
  await expect(popup.getByRole('heading', { level: 2 })).toContainText('Working');
  await expect(popup.getByRole('heading', { level: 2 })).toContainText('Working');
});

test('drag feedback follows the pointer, scrolls while held and commits manual moves directly', async ({
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
  await matchWorkspaceWindow(host);
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
  // A direct gesture commits exactly its move, without a proposal.
  await expect(targetCard.locator(`[data-tab-id="${articleId}"]`)).toBeVisible();
  await expect(ui.getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0);
  const targetRow = row(articleId);
  const end = (await targetRow.boundingBox())!;
  await row(readerId).dragTo(targetRow, { targetPosition: { x: 60, y: end.height - 5 } });
  await expect(targetCard.locator('.tab')).toHaveCount(3);
  await expect(ui.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  const finalIds = await targetCard
    .locator('.tab')
    .evaluateAll((nodes) => nodes.map((node) => Number((node as HTMLElement).dataset.tabId)));
  expect(finalIds.slice(-2)).toEqual([articleId, readerId]);
  expect(revision((await call('saul_tabs_list')) as TabSnapshot)).not.toBe(revision(before));
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
  const handle = ui.locator(`[data-tab-id="${articleId}"] input`);
  await handle.click();
  await expect(handle).toBeFocused();
  expect(await originalNode!.evaluate((node) => node.isConnected)).toBe(true);
  expect(await untouched.locator('.tabs').evaluate((list) => list.scrollTop)).toBe(scrollTop);
  await handle.press('Escape');
  await expect(ui.locator('#move-controls')).toBeHidden();
  await expect(handle).toBeFocused();
  expect(revision((await call('saul_tabs_list')) as TabSnapshot)).toBe(revision(before));
  await ui.getByText('View options', { exact: true }).click();
  const minimumMode = ui.getByRole('checkbox', { name: 'Minimum Mode', exact: true });
  await expect(minimumMode).toBeChecked();
  await minimumMode.uncheck();
  await expect(ui.locator('.help.guidance')).toBeVisible();
  // Opaque host frames cannot retain localStorage; the view discloses that limit.
  await expect(ui.locator('#preference-error')).toContainText('could not be saved');
  await host.evaluate(() => window.fixtureHost.connect());
  await host.locator('iframe').evaluate((frame) => {
    const iframe = frame as HTMLIFrameElement;
    const markup = iframe.srcdoc;
    iframe.srcdoc = markup;
  });
  await expect(ui.locator('html')).toHaveAttribute('data-minimum', 'true');
  await expect(ui.locator('.window')).toHaveCount(3);
  expect(revision((await call('saul_tabs_list')) as TabSnapshot)).toBe(revision(before));
  await ui.getByText('View options', { exact: true }).click();
  await minimumMode.check();
  await ui.getByText('View options', { exact: true }).click();
  await captureWorkspace(host, ui, info.outputPath('board-light.png'));
  await host.evaluate(() => window.fixtureHost.theme('dark'));
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

test('window cards fold, reorder locally and accept direct drops while folded', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { ui, host, popup, call, article, messages } = await openWorkspace(sandbox, fixtureServer);
  await host.setViewportSize({ width: 1100, height: 900 });
  const destinationId = await popup.evaluate(
    async (origin) =>
      (await chrome.windows.create({ url: origin + '/article#destination', focused: false }))!.id!,
    fixtureServer.origin,
  );
  await ui.getByRole('button', { name: 'Refresh', exact: true }).click();
  const before = (await call('saul_tabs_list')) as TabSnapshot;
  const tab = before.tabs.find((t) => t.url === article.url())!;
  const source = ui.locator('.window[data-window-id="' + tab.windowId + '"]');
  const target = ui.locator('.window[data-window-id="' + destinationId + '"]');
  const row = ui.locator('[data-tab-id="' + tab.id + '"]');
  await target.getByRole('button', { name: 'Fold window: Window 2', exact: true }).click();
  await expect(target.locator('.tabs')).toBeHidden();
  await source.locator('h2').dragTo(target.locator('h2'));
  await expect(ui.locator('.window').first()).toHaveAttribute(
    'data-window-id',
    String(destinationId),
  );
  expect(revision((await call('saul_tabs_list')) as TabSnapshot)).toBe(revision(before));
  await row.dragTo(target.locator('h2'));
  await expect
    .poll(
      async () =>
        ((await call('saul_tabs_list')) as TabSnapshot).tabs.find((t) => t.id === tab.id)!.windowId,
    )
    .toBe(destinationId);
  await expect(ui.getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0);
  await target.getByRole('button', { name: 'Expand window: Window 2', exact: true }).click();
  await expect(row).toBeVisible();
  await target.locator('.window-head').focus();
  await host.keyboard.press('Shift+F10');
  await expect(ui.getByRole('menu', { name: 'Actions' })).toBeVisible();
  await host.keyboard.press('Escape');
  await expect(target.locator('.window-head')).toBeFocused();
  expect(messages).toHaveLength(0);
  await captureWorkspace(host, ui, info.outputPath('direct-board.png'));
  await ui.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(source.locator('[data-tab-id="' + tab.id + '"]')).toBeVisible();
  expect(revision((await call('saul_tabs_list')) as TabSnapshot)).toBe(revision(before));
});
