import { test, expect } from './fixtures.ts';
import { openWorkspace, captureWorkspace } from './workspace-fixture.ts';
import { installDigestProvider } from './digest-fixture.ts';
import type { TabSnapshot } from '../../native/protocol.mjs';
test.use({ browserToolsFixtures: true });

test('Window scopes live selection, edits groups directly, preserves pins and offers guarded Undo', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { popup, context, worker } = await sandbox.launch();
  for (const name of ['Alpha', 'Beta', 'Gamma']) {
    const p = await context.newPage();
    await p.goto(fixtureServer.origin + '/article#' + name);
    await p.evaluate((name) => {
      document.title = name;
    }, name);
  }
  const initial = await worker.evaluate(async (origin) => {
    const tabs = await chrome.tabs.query({});
    const id = (name: string) => tabs.find((t) => t.url?.endsWith('#' + name))!.id!;
    await chrome.tabs.update(id('Gamma'), { pinned: true });
    const destination = await chrome.windows.create({ url: origin + '/long#other', focused: true });
    await chrome.storage.session.set({
      saul_window_labels: {
        [tabs.find((t) => t.id === id('Alpha'))!.windowId]: 'Reading',
        [destination!.id!]: 'Other',
      },
    });
    return {
      alpha: id('Alpha'),
      beta: id('Beta'),
      pin: id('Gamma'),
      destination: destination!.id!,
    };
  }, fixtureServer.origin);
  await popup.getByRole('button', { name: 'Window', exact: true }).click();
  await expect(popup.getByRole('heading', { name: 'Reading' })).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Preview sort' })).toHaveCount(0);
  await popup.getByRole('checkbox', { name: 'Select Beta', exact: true }).check();
  await popup.getByRole('checkbox', { name: 'Select Alpha', exact: true }).check();
  await popup.getByRole('button', { name: 'Group', exact: true }).click();
  await popup.getByRole('textbox', { name: 'Group name' }).fill('Evidence');
  await popup.getByRole('button', { name: 'Create group' }).click();
  await expect
    .poll(() =>
      worker.evaluate(async ({ alpha, beta }) => {
        const a = await chrome.tabs.get(alpha),
          b = await chrome.tabs.get(beta);
        return a.groupId >= 0 && a.groupId === b.groupId && a.index < b.index;
      }, initial),
    )
    .toBe(true);
  await popup.getByRole('button', { name: 'Clear selection' }).click();
  await popup.getByRole('checkbox', { name: 'Select Alpha', exact: true }).check();
  await popup
    .getByRole('combobox', { name: 'Move to', exact: true })
    .selectOption(String(initial.destination));
  await expect
    .poll(() =>
      worker.evaluate(async (id) => {
        const t = await chrome.tabs.get(id);
        return [t.windowId, t.groupId];
      }, initial.alpha),
    )
    .toEqual([initial.destination, -1]);
  await popup.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect
    .poll(() =>
      worker.evaluate(async ({ alpha, beta }) => {
        const a = await chrome.tabs.get(alpha),
          b = await chrome.tabs.get(beta);
        return a.windowId === b.windowId && a.groupId === b.groupId && a.groupId >= 0;
      }, initial),
    )
    .toBe(true);
  await popup.getByRole('checkbox', { name: 'Select Gamma', exact: true }).check();
  await expect(popup.getByRole('button', { name: 'Group', exact: true })).toBeDisabled();
  await expect(popup.getByRole('button', { name: 'Summarize', exact: true })).toBeEnabled();
  await popup.getByRole('button', { name: 'Clear selection' }).click();
  await popup.getByRole('checkbox', { name: 'Select Beta', exact: true }).check();
  await popup
    .getByRole('combobox', { name: 'Move to', exact: true })
    .selectOption(String(initial.destination));
  await expect(popup.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  await worker.evaluate(async (id) => {
    await chrome.tabs.create({ windowId: id, url: 'about:blank', active: false });
  }, initial.destination);
  await popup.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(popup.getByRole('alert')).toContainText('affected tabs changed');
  expect(await worker.evaluate(async (id) => (await chrome.tabs.get(id)).pinned, initial.pin)).toBe(
    true,
  );
  await popup.screenshot({ path: info.outputPath('window.png'), fullPage: true });
});

test('Tab board groups across windows, moves directly without deduplication, and opens the shared summary reader', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { ui, host, worker, context, call, article, reader } = await openWorkspace(
    sandbox,
    fixtureServer,
  );
  await installDigestProvider(worker);
  await reader.setContent(
    '<title>Long reading fixture</title><article>' +
      'Long source evidence. '.repeat(30) +
      '</article>',
  );
  const original = (await call('saul_tabs_list')) as TabSnapshot;
  const articleId = original.tabs.find((t) => t.url === article.url())!.id;
  const readerId = original.tabs.find((t) => t.url === reader.url())!.id;
  const destination = await worker.evaluate(
    async (id) => (await chrome.windows.create({ tabId: id, focused: false }))!.id!,
    readerId,
  );
  await worker.evaluate(
    async ({ url, destination }) => {
      await chrome.tabs.create({ windowId: destination, url, active: false });
      const grouped = await chrome.tabs.create({
        windowId: destination,
        url: url + '#existing-group',
        active: false,
      });
      const groupId = await chrome.tabs.group({
        tabIds: [grouped.id!],
        createProperties: { windowId: destination },
      });
      await chrome.tabGroups.update(groupId, { title: 'Other group' });
      await chrome.storage.session.set({ saul_window_labels: { [destination]: 'Other' } });
    },
    { url: article.url(), destination },
  );
  await ui.getByRole('button', { name: 'Refresh', exact: true }).click();
  await ui.locator('.tab[data-tab-id="' + articleId + '"] input').check();
  await ui.getByRole('button', { name: 'Group', exact: true }).click();
  await expect(ui.locator('#existing-group')).toBeHidden();
  await ui.locator('.tab[data-tab-id="' + readerId + '"] input').check();
  await ui.getByRole('textbox', { name: 'Group name' }).fill('Together');
  await ui
    .getByRole('combobox', { name: 'Group destination window' })
    .selectOption(String(destination));
  await expect(ui.getByRole('combobox', { name: 'Add to group' })).toContainText('Other group');
  await ui.getByRole('button', { name: 'Create group' }).click();
  await expect
    .poll(async () => {
      const s = (await call('saul_tabs_list')) as TabSnapshot;
      const a = s.tabs.find((t) => t.id === articleId)!,
        b = s.tabs.find((t) => t.id === readerId)!;
      return a.windowId === destination && a.groupId === b.groupId && a.groupId >= 0;
    })
    .toBe(true);
  await expect(ui.getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0);
  expect(
    ((await call('saul_tabs_list')) as TabSnapshot).tabs.filter((t) => t.url === article.url()),
  ).toHaveLength(2);
  const opening = context.waitForEvent('page');
  await ui.getByRole('button', { name: 'Summarize', exact: true }).click();
  const summary = await opening;
  await expect(summary.getByRole('status')).toContainText('2 of 2 summarized');
  await captureWorkspace(host, ui, info.outputPath('tab-board.png'));
  await host.setViewportSize({ width: 440, height: 850 });
  await host.screenshot({ path: info.outputPath('tab-board-narrow.png'), fullPage: true });
  expect(
    await ui.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});

test('group drags preserve metadata and individual tab drops join and leave groups', async ({
  sandbox,
  fixtureServer,
}) => {
  const { ui, host, worker, call, article, reader } = await openWorkspace(sandbox, fixtureServer);
  await host.setViewportSize({ width: 1100, height: 1000 });
  const before = (await call('saul_tabs_list')) as TabSnapshot;
  const a = before.tabs.find((t) => t.url === article.url())!,
    b = before.tabs.find((t) => t.url === reader.url())!;
  const setup = await worker.evaluate(
    async ({ a, b, origin }) => {
      const c = await chrome.tabs.create({
        windowId: a.windowId,
        url: origin + '/article#third',
        active: false,
      });
      const groupId = await chrome.tabs.group({
        tabIds: [a.id, b.id],
        createProperties: { windowId: a.windowId },
      });
      await chrome.tabGroups.update(groupId, { title: 'Evidence', color: 'pink', collapsed: true });
      const destination = await chrome.windows.create({
        url: origin + '/article#destination',
        focused: false,
      });
      return { c: c.id!, groupId, destination: destination!.id! };
    },
    { a, b, origin: fixtureServer.origin },
  );
  await ui.getByRole('button', { name: 'Refresh', exact: true }).click();
  const target = ui.locator('.window[data-window-id="' + setup.destination + '"]');
  await ui.locator('[data-group-id="' + setup.groupId + '"]').dragTo(target.locator('.window-end'));
  await expect
    .poll(async () => {
      const s = (await call('saul_tabs_list')) as TabSnapshot;
      return s.groups.find((g) => g.id === setup.groupId);
    })
    .toMatchObject({
      windowId: setup.destination,
      title: 'Evidence',
      color: 'pink',
      collapsed: true,
    });
  await worker.evaluate(
    async (url) => chrome.windows.create({ url, focused: false }),
    fixtureServer.origin + '/article#unrelated',
  );
  await ui.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(ui.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  await ui.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect
    .poll(
      async () =>
        ((await call('saul_tabs_list')) as TabSnapshot).tabs.find((t) => t.id === a.id)!.windowId,
    )
    .toBe(a.windowId);
  if (await ui.getByRole('button', { name: 'Clear', exact: true }).isVisible())
    await ui.getByRole('button', { name: 'Clear', exact: true }).click();
  const restored = (await call('saul_tabs_list')) as TabSnapshot;
  const groupId = restored.tabs.find((t) => t.id === a.id)!.groupId;
  await ui
    .locator('[data-tab-id="' + setup.c + '"]')
    .dragTo(ui.locator('[data-group-id="' + groupId + '"]'));
  await expect
    .poll(
      async () =>
        ((await call('saul_tabs_list')) as TabSnapshot).tabs.find((t) => t.id === setup.c)!.groupId,
    )
    .toBe(groupId);
  if (await ui.getByRole('button', { name: 'Clear', exact: true }).isVisible())
    await ui.getByRole('button', { name: 'Clear', exact: true }).click();
  await ui
    .locator('[data-tab-id="' + b.id + '"]')
    .dragTo(ui.locator('.window[data-window-id="' + a.windowId + '"] .window-end'));
  await expect
    .poll(
      async () =>
        ((await call('saul_tabs_list')) as TabSnapshot).tabs.find((t) => t.id === b.id)!.groupId,
    )
    .toBe(-1);
  expect(
    ((await call('saul_tabs_list')) as TabSnapshot).tabs.find((t) => t.id === a.id)!.groupId,
  ).toBe(groupId);
  await worker.evaluate((id) => chrome.tabGroups.update(id, { collapsed: true }), groupId);
  await ui.getByRole('button', { name: 'Refresh', exact: true }).click();
  const priorMove = (await call('saul_tabs_list')) as TabSnapshot;
  await ui.locator('[data-group-id="' + groupId + '"]').dragTo(ui.locator('.new-window'));
  await expect
    .poll(async () => {
      const next = (await call('saul_tabs_list')) as TabSnapshot;
      const group = next.groups.find((g) => g.id === groupId);
      return Boolean(group && !priorMove.windows.some((w) => w.id === group.windowId));
    })
    .toBe(true);
  const afterMove = (await call('saul_tabs_list')) as TabSnapshot;
  expect(afterMove.tabs.map((t) => t.id).sort()).toEqual(priorMove.tabs.map((t) => t.id).sort());
  expect(afterMove.groups.find((g) => g.id === groupId)).toMatchObject({
    title: 'Evidence',
    color: 'pink',
    collapsed: true,
  });
  await ui.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect
    .poll(
      async () =>
        ((await call('saul_tabs_list')) as TabSnapshot).groups.find((g) => g.id === groupId)
          ?.windowId,
    )
    .toBe(a.windowId);
});
