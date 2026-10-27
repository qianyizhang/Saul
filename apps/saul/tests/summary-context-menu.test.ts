import { afterEach, expect, it, vi } from 'vitest';
import { initSummaryContextMenu, SUMMARY_MENU_ID } from '../src/digest/context-menu';
import { openSummaryReader } from '../src/digest/reader';

vi.mock('../src/digest/reader', () => ({ openSummaryReader: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function fixture() {
  const installed = vi.fn();
  const clicked = vi.fn();
  const create = vi.fn((_properties: unknown, done: () => void) => done());
  const removeAll = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', {
    runtime: { onInstalled: { addListener: installed } },
    contextMenus: { create, removeAll, onClicked: { addListener: clicked } },
  });
  initSummaryContextMenu();
  return {
    install: installed.mock.calls[0]![0] as () => void,
    click: clicked.mock.calls[0]![0] as (
      info: Partial<chrome.contextMenus.OnClickData>,
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
    id: SUMMARY_MENU_ID,
    title: 'Saul Summarize',
    documentUrlPatterns: ['http://*/*', 'https://*/*'],
  });
});

it('opens the clicked tab even for selections or links, and ignores unrelated or private clicks', () => {
  const f = fixture();
  vi.mocked(openSummaryReader).mockResolvedValue({ id: 'summary' });
  f.click(
    {
      menuItemId: SUMMARY_MENU_ID,
      selectionText: 'Only a selection',
      linkUrl: 'https://other.test',
    },
    { id: 42 },
  );
  expect(openSummaryReader).toHaveBeenCalledExactlyOnceWith({ tabIds: [42] });
  f.click({ menuItemId: 'other' }, { id: 1 });
  f.click({ menuItemId: SUMMARY_MENU_ID });
  f.click({ menuItemId: SUMMARY_MENU_ID }, { id: 1, incognito: true });
  expect(openSummaryReader).toHaveBeenCalledOnce();
});

it('handles a vanished tab and menu registration failure without replaying the request', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const f = fixture();
  vi.mocked(openSummaryReader).mockRejectedValue(new Error('No tab with id: 42'));
  f.click({ menuItemId: SUMMARY_MENU_ID }, { id: 42 });
  await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
  expect(openSummaryReader).toHaveBeenCalledOnce();
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
