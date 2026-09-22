import { expect, it } from 'vitest';
import { validateWorkspaceRequest } from '../src/native/workspace';

it('accepts typed workspace requests and rejects unsafe preview fields', () => {
  expect(() => validateWorkspaceRequest({ action: 'list' })).not.toThrow();
  expect(() =>
    validateWorkspaceRequest({
      action: 'preview',
      method: 'saul_tabs_sort',
      args: { windowId: 1, by: 'title' },
    }),
  ).not.toThrow();

  for (const request of [
    { action: 'preview', method: 'saul_tabs_list', args: {} },
    {
      action: 'preview',
      method: 'saul_tabs_sort',
      args: { windowId: 1, by: 'title', dryRun: false },
    },
    {
      action: 'preview',
      method: 'saul_tabs_sort',
      args: { windowId: 1, by: 'title', session: 'x' },
    },
    { action: 'preview', method: 'saul_tabs_sort', args: { windowId: -1, by: 'title' } },
    { action: 'apply', token: '' },
  ])
    expect(() => validateWorkspaceRequest(request)).toThrow();
});
