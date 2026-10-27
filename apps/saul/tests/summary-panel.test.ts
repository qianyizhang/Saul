import { afterEach, expect, it, vi } from 'vitest';
import { openSummaryPanel, summaryPanelKey, summaryPanelRoute } from '../src/digest/panel';
import { workspaceSender } from '../src/contracts/reading';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('dispatches panel opening in the gesture without waiting for storage, and scopes the route to the window', async () => {
  let finish!: () => void;
  const written = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const set = vi.fn((_values: Record<string, unknown>) => written);
  const open = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', { storage: { session: { set } }, sidePanel: { open } });
  const result = openSummaryPanel(7, { tabIds: [42] });
  expect(open).toHaveBeenCalledExactlyOnceWith({ windowId: 7 });
  const route = set.mock.calls[0]![0] as Record<string, string>;
  expect(Object.keys(route)).toEqual([summaryPanelKey(7)]);
  expect(route[summaryPanelKey(7)]).toMatch(/^#summary\/[^?]+\?tabs=42$/);
  finish();
  await expect(result).resolves.toHaveProperty('id');
});

it('reports a denied panel open without creating a fallback tab', async () => {
  const create = vi.fn();
  vi.stubGlobal('chrome', {
    storage: { session: { set: vi.fn().mockResolvedValue(undefined) } },
    sidePanel: { open: vi.fn().mockRejectedValue(new Error('User gesture required')) },
    tabs: { create },
  });
  await expect(openSummaryPanel(7, { id: 'saved-summary' })).rejects.toThrow(
    'User gesture required',
  );
  expect(create).not.toHaveBeenCalled();
});

it('validates requests and retained routes before mounting the reader', async () => {
  for (const value of [
    undefined,
    '#settings',
    '#summary/%',
    '#summary/',
    '#summary/ok?tabs=',
    '#summary/ok?tabs=-1',
    '#summary/ok?tabs=1,1',
  ])
    expect(summaryPanelRoute(value)).toBe('#summaries');
  for (const value of ['#summaries', '#summary/saved-id', '#summary/new-id?tabs=1,2'])
    expect(summaryPanelRoute(value)).toBe(value);
  await expect(openSummaryPanel(-1, { tabIds: [1] })).rejects.toThrow('window');
  await expect(openSummaryPanel(7, { tabIds: [1], id: 'saved-id' })).rejects.toThrow();
});

it('trusts the packaged panel through the same workspace boundary and rejects web pages and lookalikes', () => {
  vi.stubGlobal('chrome', {
    runtime: { id: 'saul', getURL: (path: string) => 'chrome-extension://saul/' + path },
  });
  expect(
    workspaceSender({ id: 'saul', url: 'chrome-extension://saul/summary-panel.html#summary/id' }),
  ).toBe(true);
  expect(workspaceSender({ id: 'saul', url: 'https://example.test/summary-panel.html' })).toBe(
    false,
  );
  expect(workspaceSender({ id: 'other', url: 'chrome-extension://saul/summary-panel.html' })).toBe(
    false,
  );
  expect(
    workspaceSender({ id: 'saul', url: 'chrome-extension://saul/summary-panel.html.extra' }),
  ).toBe(false);
});

it('closes only the selected window panel and reports unsupported browsers or failed closes', async () => {
  const { closeSummaryPanel } = await import('../src/digest/panel');
  const close = vi.fn().mockResolvedValue(undefined);
  const remove = vi.fn();
  vi.stubGlobal('chrome', { sidePanel: { close }, tabs: { remove } });
  await closeSummaryPanel(7);
  expect(close).toHaveBeenCalledExactlyOnceWith({ windowId: 7 });
  expect(remove).not.toHaveBeenCalled();
  await expect(closeSummaryPanel(-1)).rejects.toThrow('window');
  close.mockRejectedValue(new Error('Window closed'));
  await expect(closeSummaryPanel(7)).rejects.toThrow('Window closed');
  vi.stubGlobal('chrome', { sidePanel: {} });
  await expect(closeSummaryPanel(7)).rejects.toThrow('Chrome 141');
});
