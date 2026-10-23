import { expect, it } from 'vitest';
import { workspaceState } from '../native/workspace-contract.mts';
import { validateToolResult } from '../native/results.mts';
import { tab } from './fixtures.mts';

const snapshot = {
  windows: [{ id: 1, focused: false }],
  tabs: [tab({ id: 10, windowId: 1 })],
  groups: [],
};
const state = {
  sessions: [{ session: 'a'.repeat(16), extensionId: 'b'.repeat(32) }],
  snapshot,
  proposal: null,
};
it('accepts an unselected browser and a validated current inventory', () => {
  expect(workspaceState({ ...state, snapshot: null })).toMatchObject({ snapshot: null });
  expect(workspaceState(state)).toEqual(state);
  expect(validateToolResult('saul_tabs_list', snapshot)).toEqual(snapshot);
});
it('rejects malformed browser results before exposing typed data', () => {
  for (const invalid of [
    null,
    {},
    { ...snapshot, tabs: [{ id: 10 }] },
    { ...snapshot, windows: [{ id: '1', focused: false }] },
  ]) {
    expect(() => validateToolResult('saul_tabs_list', invalid)).toThrow('Invalid browser result');
    expect(() => workspaceState({ ...state, snapshot: invalid === null ? {} : invalid })).toThrow(
      'Invalid Saul workspace',
    );
  }
});
it('retains a failed proposal when its post-apply inventory cannot refresh, but rejects unknown projected tabs', () => {
  const proposal = {
    id: 'p',
    status: 'failed',
    summary: 'Review',
    revision: 'r',
    deduplicate: false,
    expiresAt: 100,
    changedTabIds: [10],
    before: snapshot,
    windows: [{ windowId: 1, title: 'A', tabIds: [10] }],
    projected: [{ id: 1, title: 'A', tabIds: [10] }],
    duplicates: [],
    receipt: { completedMoves: 0, completedClosures: 0, message: 'Connection lost' },
  };
  expect(
    workspaceState({ ...state, snapshot: null, proposal, error: 'Cannot refresh' }).proposal,
  ).toEqual(proposal);
  expect(() =>
    workspaceState({
      ...state,
      proposal: { ...proposal, projected: [{ id: 1, title: 'A', tabIds: [99] }] },
    }),
  ).toThrow('unknown tab');
});
