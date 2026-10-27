import { afterEach, expect, it, vi } from 'vitest';
import { initSummaryActions, SUMMARY_ACTION_ID, SUMMARY_CLOSE_ID } from '../src/digest/actions';
import { closeSummaryPanel, openSummaryPanel } from '../src/digest/panel';

vi.mock('../src/digest/panel', () => ({ openSummaryPanel: vi.fn(), closeSummaryPanel: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function fixture() {
  const installed = vi.fn();
  const clicked = vi.fn();
  const commanded = vi.fn();
  const create = vi.fn((_properties: unknown, done: () => void) => done());
  const removeAll = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', {
    runtime: { onInstalled: { addListener: installed } },
    contextMenus: { create, removeAll, onClicked: { addListener: clicked } },
    commands: { onCommand: { addListener: commanded } },
  });
  initSummaryActions();
  return {
    install: installed.mock.calls[0]![0] as () => void,
    click: clicked.mock.calls[0]![0] as (
      info: Partial<chrome.contextMenus.OnClickData>,
      tab?: Partial<chrome.tabs.Tab>,
    ) => void,
    command: commanded.mock.calls[0]![0] as (
      command: string,
      tab?: Partial<chrome.tabs.Tab>,
    ) => void,
    create,
    removeAll,
  };
}

it('registers one HTTP(S) page action on installation or update, not on worker wake', async () => {
  const f = fixture();
  expect(f.create).not.toHaveBeenCalled();
  f.install();
  await vi.waitFor(() => expect(f.create).toHaveBeenCalledOnce());
  expect(f.removeAll).toHaveBeenCalledOnce();
  expect(f.create.mock.calls[0]![0]).toMatchObject({
    id: SUMMARY_ACTION_ID,
    title: 'Saul Summarize',
    documentUrlPatterns: ['http://*/*', 'https://*/*'],
  });
});

it('opens the clicked tab even for selections or links, and ignores unrelated or private clicks', () => {
  const f = fixture();
  vi.mocked(openSummaryPanel).mockResolvedValue({ id: 'summary' });
  f.click(
    {
      menuItemId: SUMMARY_ACTION_ID,
      selectionText: 'Only a selection',
      linkUrl: 'https://other.test',
    },
    { id: 42, windowId: 9, url: 'https://source.test/article' },
  );
  expect(openSummaryPanel).toHaveBeenCalledExactlyOnceWith(9, { tabIds: [42] });
  f.click({ menuItemId: 'other' }, { id: 1 });
  f.click({ menuItemId: SUMMARY_ACTION_ID });
  f.click({ menuItemId: SUMMARY_ACTION_ID }, { id: 1, incognito: true });
  expect(openSummaryPanel).toHaveBeenCalledOnce();
});

it('handles a vanished tab and menu registration failure without replaying the request', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const f = fixture();
  vi.mocked(openSummaryPanel).mockRejectedValue(new Error('No tab with id: 42'));
  f.click(
    { menuItemId: SUMMARY_ACTION_ID },
    { id: 42, windowId: 9, url: 'https://source.test/article' },
  );
  await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
  expect(openSummaryPanel).toHaveBeenCalledOnce();
  f.removeAll.mockRejectedValue(new Error('Menu unavailable'));
  f.install();
  await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
  expect(f.create).not.toHaveBeenCalled();
});

it('reports Chrome menu creation errors from the callback', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const f = fixture();
  Object.assign(chrome.runtime, { lastError: { message: 'Permission denied' } });
  f.install();
  await vi.waitFor(() =>
    expect(warn).toHaveBeenCalledWith(
      '[Saul] Could not register summary menu',
      'Permission denied',
    ),
  );
});

it('summarizes the command event tab and ignores unknown commands and unsupported pages', () => {
  const f = fixture();
  vi.mocked(openSummaryPanel).mockResolvedValue({ id: 'summary' });
  f.command(SUMMARY_ACTION_ID, { id: 42, windowId: 9, url: 'https://source.test/article' });
  expect(openSummaryPanel).toHaveBeenCalledExactlyOnceWith(9, { tabIds: [42] });
  f.command('other', { id: 7, url: 'https://other.test' });
  f.command(SUMMARY_ACTION_ID);
  f.command(SUMMARY_ACTION_ID, { id: 7, url: 'chrome://settings' });
  f.command(SUMMARY_ACTION_ID, { id: 7, url: 'https://private.test', incognito: true });
  expect(openSummaryPanel).toHaveBeenCalledOnce();
});

it('reports shortcut reader failures without retrying', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const f = fixture();
  vi.mocked(openSummaryPanel).mockRejectedValue(new Error('No tab with id: 42'));
  f.command(SUMMARY_ACTION_ID, { id: 42, windowId: 9, url: 'https://source.test/article' });
  await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
  expect(openSummaryPanel).toHaveBeenCalledOnce();
});

it('closes only the commanded regular window panel, even from a non-web tab', () => {
  const f = fixture();
  vi.mocked(closeSummaryPanel).mockResolvedValue(undefined);
  f.command(SUMMARY_CLOSE_ID, { id: 5, windowId: 9, url: 'chrome://newtab/' });
  expect(closeSummaryPanel).toHaveBeenCalledExactlyOnceWith(9);
  f.command(SUMMARY_CLOSE_ID);
  f.command(SUMMARY_CLOSE_ID, { windowId: 1, incognito: true });
  expect(closeSummaryPanel).toHaveBeenCalledOnce();
});
