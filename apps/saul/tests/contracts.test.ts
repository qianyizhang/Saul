import { expect, it, vi, afterEach } from 'vitest';
import {
  CLI_COMMANDS,
  TOOLS,
  TRANSPORT_TOOLS,
  validateCall,
  type ToolArgs,
  type ToolName,
} from '../native/protocol.mjs';
import {
  validateReading,
  sourcePage,
  workspaceSender,
  backgroundSender,
} from '../src/contracts/reading';
import { validateWorkspace } from '../src/contracts/workspace';
const fields = {
  saul_tabs_edit: [
    'session',
    'kind',
    'expected',
    'tabIds',
    'windowId',
    'beforeTabId',
    'groupId',
    'title',
  ],
  saul_tabs_undo: ['session', 'token'],
  saul_summary_open: ['session', 'tabIds', 'id'],
  saul_summary_status: ['session'],
  saul_windows_label: ['session', 'windows', 'dryRun'],
  saul_tabs_close_duplicates: ['session', 'duplicates', 'dryRun'],
  saul_windows_create: ['session', 'tabIds', 'focused', 'dryRun'],
  saul_page_read: ['session', 'tabId'],
  saul_page_act: [
    'session',
    'tabId',
    'documentId',
    'snapshotId',
    'elementId',
    'action',
    'value',
    'dryRun',
  ],
  saul_page_navigate: ['session', 'tabId', 'expectedUrl', 'url', 'dryRun'],
  saul_sessions: [],
  saul_tabs_list: ['session', 'windowId'],
  saul_tabs_sort: ['session', 'windowId', 'by', 'descending', 'dryRun'],
  saul_tabs_group: ['session', 'tabIds', 'groupId', 'title', 'color', 'collapsed', 'dryRun'],
  saul_tabs_ungroup: ['session', 'tabIds', 'dryRun'],
  saul_tabs_move: ['session', 'tabIds', 'windowId', 'index', 'dryRun'],
  saul_groups_update: ['session', 'groupId', 'title', 'color', 'collapsed', 'dryRun'],
} as const satisfies { [K in ToolName]: readonly (keyof ToolArgs[K])[] };
const complete: {
  [K in ToolName]: K extends 'saul_sessions'
    ? true
    : Exclude<keyof ToolArgs[K], (typeof fields)[K][number]> extends never
      ? true
      : never;
} = {
  saul_tabs_edit: true,
  saul_tabs_undo: true,
  saul_summary_open: true,
  saul_summary_status: true,
  saul_windows_label: true,
  saul_tabs_close_duplicates: true,
  saul_windows_create: true,
  saul_page_read: true,
  saul_page_act: true,
  saul_page_navigate: true,
  saul_sessions: true,
  saul_tabs_list: true,
  saul_tabs_sort: true,
  saul_tabs_group: true,
  saul_tabs_ungroup: true,
  saul_tabs_move: true,
  saul_groups_update: true,
};
const samples = {
  saul_tabs_edit: { kind: 'move', expected: '{}', tabIds: [1], windowId: 2 },
  saul_tabs_undo: { token: 'undo' },
  saul_summary_open: { tabIds: [1] },
  saul_summary_status: {},
  saul_windows_label: { windows: [{ windowId: 1, title: 'Reading' }] },
  saul_tabs_close_duplicates: {
    duplicates: [{ tabId: 2, keepTabId: 1, url: 'https://example.com/' }],
  },
  saul_windows_create: { tabIds: [1] },
  saul_page_read: { tabId: 1 },
  saul_page_act: {
    tabId: 1,
    documentId: 'doc',
    snapshotId: 'snapshot',
    elementId: 0,
    action: 'click',
  },
  saul_page_navigate: {
    tabId: 1,
    expectedUrl: 'https://example.com/',
    url: 'https://example.com/next',
  },
  saul_sessions: {},
  saul_tabs_list: {},
  saul_tabs_sort: { windowId: 1, by: 'title' },
  saul_tabs_group: { tabIds: [1] },
  saul_tabs_ungroup: { tabIds: [1] },
  saul_tabs_move: { tabIds: [1], windowId: 2, index: -1 },
  saul_groups_update: { groupId: 1, title: 'Hello' },
} satisfies ToolArgs;
it('native declarations and executable schema cover the same tool and argument names', () => {
  expect(TRANSPORT_TOOLS.map((t) => t.name).sort()).toEqual(Object.keys(complete).sort());
  expect(Object.values(CLI_COMMANDS).sort()).toEqual(TOOLS.map((tool) => tool.name).sort());
  expect(new Set(Object.keys(CLI_COMMANDS)).size).toBe(TOOLS.length);
  for (const tool of TRANSPORT_TOOLS) {
    expect(Object.keys(tool.inputSchema.properties || {}).sort()).toEqual(
      [...fields[tool.name]].sort(),
    );
    expect(validateCall(tool.name, samples[tool.name])).toEqual(samples[tool.name]);
    expect(() => validateCall(tool.name, { ...samples[tool.name], unknown: true })).toThrow();
  }
});
afterEach(() => vi.unstubAllGlobals());
it('separates source pages, workspace and background capabilities', () => {
  vi.stubGlobal('chrome', {
    runtime: { id: 'test', getURL: (path: string) => 'chrome-extension://test/' + path },
  });
  const page = {
    id: 'test',
    url: 'https://example.test/a?doc=1#route',
    tab: { id: 1, url: 'https://example.test/a?doc=1#route' },
    frameId: 0,
  } as chrome.runtime.MessageSender;
  expect(sourcePage(page)).toBe(page.url);
  expect(
    sourcePage({ ...page, tab: { ...page.tab!, url: 'https://example.test/new#route' } }),
  ).toBe('https://example.test/new#route');
  expect(() =>
    sourcePage({ ...page, tab: { ...page.tab!, url: 'https://other.test/' } }),
  ).toThrow();
  expect(workspaceSender(page)).toBe(false);
  expect(backgroundSender(page)).toBe(false);
  expect(() => sourcePage({ ...page, frameId: 1 })).toThrow();
  expect(() => sourcePage({ ...page, id: 'other' })).toThrow();
  expect(workspaceSender({ id: 'test', url: 'chrome-extension://test/library.html#history' })).toBe(
    true,
  );
  expect(workspaceSender({ id: 'test', url: 'chrome-extension://test/untrusted.html' })).toBe(
    false,
  );
  expect(backgroundSender({ id: 'test', url: 'chrome-extension://test/background.js' })).toBe(true);
  expect(backgroundSender({ id: 'test', url: 'chrome-extension://test/popup.html' })).toBe(false);
});
it('rejects malformed requests and raw job writes from the workspace', () => {
  expect(() => validateReading({ action: 'mute-errors', muted: true })).not.toThrow();
  expect(() => validateReading({ action: 'mute-errors', muted: 'true' })).toThrow();
  expect(() =>
    validateReading({ action: 'bookmark', selectionId: 'id', bookmarked: 'yes' }),
  ).toThrow();
  expect(() =>
    validateReading({ action: 'regenerate', submissionId: 's', selectionId: 'id' }),
  ).not.toThrow();
  expect(() => validateWorkspace({ type: 'DB_SUBMIT', payload: {} })).toThrow();
  expect(() =>
    validateWorkspace({ type: 'DB_GET_HISTORY', payload: { limit: Infinity } }),
  ).toThrow();
  expect(() =>
    validateWorkspace({ type: 'DB_GET_HISTORY', payload: { searchQuery: 'term' } }),
  ).not.toThrow();
});
