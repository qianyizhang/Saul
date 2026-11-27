import type { CallToolResult } from '@modelcontextprotocol/client';
import { expect, it, vi } from 'vitest';
import { createBoardSession } from '../board/board-session';
import type { WorkspaceState } from '../shared/protocol/workspace-contract.mts';

const sessions = [
  { session: 'page-a', extensionId: 'test' },
  { session: 'page-b', extensionId: 'test' },
];
const snapshot = { tabs: [], windows: [], groups: [] };

function response(
  session: string,
  token: string,
  proposal: WorkspaceState['proposal'] = null,
): CallToolResult {
  const state: WorkspaceState = {
    sessions,
    session,
    snapshot,
    proposal,
    revision: token,
  };
  return {
    content: [],
    structuredContent: { ...state },
    _meta: { interactionToken: token, approvalToken: token },
  };
}

it('starts a new refresh for the selected session and discards the previous session’s reply', async () => {
  const oldRequest = Promise.withResolvers<CallToolResult>();
  const newRequest = Promise.withResolvers<CallToolResult>();
  const call = vi
    .fn()
    .mockReturnValueOnce(oldRequest.promise)
    .mockReturnValueOnce(newRequest.promise)
    .mockResolvedValueOnce(response('page-b', 'edited-b'));
  const status = vi.fn();
  const board = createBoardSession({
    call,
    changed: vi.fn(),
    status,
    onSessionChange: vi.fn(),
    onPreview: vi.fn(),
    dragActive: () => false,
    tabDragActive: () => false,
  });
  board.hostResult(response('page-a', 'initial-a'));
  board.setReady(true);
  const refreshing = board.refresh();
  const switching = board.selectSession('page-b');
  expect(call.mock.calls.slice(0, 2)).toEqual([
    ['saul_workspace_state', { session: 'page-a' }],
    ['saul_workspace_state', { session: 'page-b' }],
  ]);
  oldRequest.resolve(response('page-a', 'stale-a'));
  await refreshing;
  expect(board.state).toMatchObject({
    data: { session: 'page-b', snapshot: null },
    refreshing: true,
  });
  expect(board.state.approvalToken).toBeUndefined();

  newRequest.resolve(response('page-b', 'fresh-b'));
  await switching;
  board.hostResult(response('page-a', 'pushed-a'));
  expect(board.state).toMatchObject({
    data: { session: 'page-b', revision: 'fresh-b' },
    approvalToken: 'fresh-b',
    refreshing: false,
  });
  expect(await board.manual('saul_workspace_undo')).toBe(true);
  expect(call).toHaveBeenLastCalledWith('saul_workspace_undo', {
    session: 'page-b',
    interactionToken: 'fresh-b',
  });
  expect(status).not.toHaveBeenCalledWith(expect.anything(), true);
});

it('accepts a late host result only for a discovered browser when no browser is selected', async () => {
  const board = createBoardSession({
    call: async () => ({
      content: [],
      structuredContent: { sessions, snapshot: null, proposal: null },
    }),
    changed: vi.fn(),
    status: vi.fn(),
    onSessionChange: vi.fn(),
    onPreview: vi.fn(),
    dragActive: () => false,
    tabDragActive: () => false,
  });
  board.setReady(true);
  await board.refresh();

  board.hostResult(response('gone', 'stale'));
  expect(board.state.data?.session).toBeUndefined();
  expect(board.state.approvalToken).toBeUndefined();

  board.hostResult(response('page-b', 'fresh'));
  expect(board.state.data?.session).toBe('page-b');
  expect(board.state.approvalToken).toBe('fresh');
});

it('uses the same approval eligibility for rendering and applying a proposal', async () => {
  const call = vi.fn(async () => response('page-a', 'applied'));
  const board = createBoardSession({
    call,
    changed: vi.fn(),
    status: vi.fn(),
    onSessionChange: vi.fn(),
    onPreview: vi.fn(),
    dragActive: () => false,
    tabDragActive: () => false,
  });
  board.setReady(true);
  const pending = (expiresAt: number) => {
    board.hostResult(
      response('page-a', 'approve', {
        id: 'proposal',
        status: 'pending',
        summary: 'Arrange tabs',
        revision: 'approve',
        before: snapshot,
        windows: [],
        projected: [],
        duplicates: [],
        changedTabIds: [],
        deduplicate: false,
        expiresAt,
      }),
    );
  };

  pending(Date.now() - 1);
  expect(board.canApply()).toBe(false);
  await board.apply();
  expect(call).not.toHaveBeenCalled();

  pending(Date.now() + 10_000);
  expect(board.canApply()).toBe(true);
  await board.apply();
  expect(call).toHaveBeenCalledOnce();
  expect(call).toHaveBeenCalledWith('saul_workspace_apply', {
    session: 'page-a',
    proposalId: 'proposal',
    approvalToken: 'approve',
  });
});
