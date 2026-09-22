import { expect, it, vi, afterEach } from 'vitest';
import { TOOLS, validateCall, type ToolArgs, type ToolName } from '../native/protocol.mjs';
import {
  validateReading,
  sourcePage,
  workspaceSender,
  backgroundSender,
} from '../src/contracts/reading';
import { validateWorkspace } from '../src/contracts/workspace';
const fields = {
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
  saul_sessions: true,
  saul_tabs_list: true,
  saul_tabs_sort: true,
  saul_tabs_group: true,
  saul_tabs_ungroup: true,
  saul_tabs_move: true,
  saul_groups_update: true,
};
const samples = {
  saul_sessions: {},
  saul_tabs_list: {},
  saul_tabs_sort: { windowId: 1, by: 'title' },
  saul_tabs_group: { tabIds: [1] },
  saul_tabs_ungroup: { tabIds: [1] },
  saul_tabs_move: { tabIds: [1], windowId: 2, index: -1 },
  saul_groups_update: { groupId: 1, title: 'Hello' },
} satisfies ToolArgs;
it('native declarations and executable schema cover the same tool and argument names', () => {
  expect(TOOLS.map((t) => t.name).sort()).toEqual(Object.keys(complete).sort());
  for (const tool of TOOLS) {
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
