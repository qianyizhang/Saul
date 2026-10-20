import { expect, it } from 'vitest';
import { validateWorkspaceRequest } from '../src/native/workspace';
it('accepts direct extension actions and rejects external, preview and arbitrary native operations', () => {
  expect(() => validateWorkspaceRequest({ action: 'list' })).not.toThrow();
  expect(() =>
    validateWorkspaceRequest({
      action: 'command',
      method: 'saul_tabs_edit',
      args: {
        kind: 'move',
        expected: '{}',
        tabIds: [1],
        windowId: 2,
      },
    }),
  ).not.toThrow();
  for (const request of [
    { action: 'preview', method: 'saul_tabs_sort', args: { windowId: 1, by: 'title' } },
    { action: 'command', method: 'saul_tabs_close_duplicates', args: {} },
    {
      action: 'command',
      method: 'saul_tabs_edit',
      args: { kind: 'move', expected: '{}', tabIds: [1], session: 'x' },
    },
    {
      action: 'command',
      method: 'saul_tabs_edit',
      args: { kind: 'move', expected: '{}', tabIds: [1, 1] },
    },
    { action: 'command', method: 'saul_summary_open', args: { tabIds: [-1] } },
  ])
    expect(() => validateWorkspaceRequest(request)).toThrow();
});
