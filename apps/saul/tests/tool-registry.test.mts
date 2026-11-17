import { expect, expectTypeOf, it } from 'vitest';
import {
  TOOL_OPERATIONS,
  TOOLS,
  TRANSPORT_TOOLS,
  validateCall,
  type ToolArgs,
  type ToolResults,
} from '../shared/protocol/protocol.mts';
import { validateToolResult } from '../shared/protocol/results.mts';
import { appRequest } from '../shared/protocol/app-protocol.mts';
import { validateDiagnosticCall } from '../shared/protocol/diagnostic-protocol.mts';
import { eventSchema } from '../shared/protocol/diagnostic-events.mts';

const group = { id: 2, windowId: 1, color: 'blue' as const, collapsed: false };
const snapshot = { windows: [{ id: 1, focused: true }], tabs: [], groups: [group] };
// Independent wire examples retained across the refactor, not generated from its schemas.
const replies = {
  saul_annotations: { records: [] },
  saul_windows_label: { dryRun: true, windows: [{ windowId: 1, title: '' }] },
  saul_tabs_close_duplicates: { dryRun: true, tabIds: [] },
  saul_windows_create: { dryRun: true, tabIds: [] },
  saul_page_read: {
    url: '',
    title: '',
    text: '',
    snapshotId: '',
    documentId: '',
    truncated: false,
    elementsTruncated: false,
    elements: [{ elementId: 0, tag: '', label: '', type: '' }],
  },
  saul_page_act: { dryRun: true, action: 'click', elementId: 0, url: '' },
  saul_page_navigate: { dryRun: true, tabId: 1, url: '' },
  saul_sessions: { sessions: [{ session: '', extensionId: '', pid: 1, connectedAt: '' }] },
  saul_tabs_list: snapshot,
  saul_tabs_sort: { dryRun: true, tabIds: [], windowId: 1 },
  saul_tabs_group: { dryRun: true, tabIds: [], windowId: 1 },
  saul_tabs_ungroup: { dryRun: true, tabIds: [] },
  saul_tabs_move: { dryRun: true, tabIds: [], windowId: 1, index: -1 },
  saul_groups_update: { dryRun: true, before: group, group },
  saul_tabs_edit: { snapshot, message: '' },
  saul_tabs_undo: { snapshot, message: '' },
  saul_summary_open: { id: '' },
  saul_summary_status: null,
} satisfies ToolResults;

it('derives an exact empty-argument type rather than the permissive object type', () => {
  expectTypeOf<ToolArgs['saul_sessions']>().toEqualTypeOf<Record<string, never>>();
});

it('checks every operation result without stripping browser extension metadata', () => {
  expect(Object.keys(TOOL_OPERATIONS).sort()).toEqual(Object.keys(replies).sort());
  for (const name of Object.keys(replies) as (keyof typeof replies)[]) {
    const value = replies[name];
    expect(validateToolResult(name, value)).toBe(value);
    expect(() => validateToolResult(name, { malformed: true })).toThrow('Invalid browser result');
    if (name !== 'saul_annotations' && value !== null) {
      const extended = { ...value, futureMetadata: { keep: true } };
      expect(validateToolResult(name, extended)).toBe(extended);
      for (const key of Object.keys(value))
        expect(() => validateToolResult(name, { ...value, [key]: null }), `${name}.${key}`).toThrow(
          'Invalid browser result',
        );
    }
  }
});

it('preserves optional, nullable and safe-integer result semantics', () => {
  expect(validateToolResult('saul_summary_status', null)).toBeNull();
  expect(() => validateToolResult('saul_summary_status', undefined)).toThrow();
  const optional = { dryRun: false, tabIds: [], windowId: undefined };
  expect(validateToolResult('saul_windows_create', optional)).toBe(optional);
  expect(() =>
    validateToolResult('saul_windows_create', { ...optional, windowId: null }),
  ).toThrow();
  expect(
    validateToolResult('saul_tabs_group', {
      dryRun: true,
      tabIds: [],
      windowId: 1,
      color: 'future-color',
    }).color,
  ).toBe('future-color');
  for (const id of [1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])
    expect(() =>
      validateToolResult('saul_page_navigate', { dryRun: false, tabId: id, url: '' }),
    ).toThrow();
});

it('preserves argument bounds, duplicate checks and absence without injecting defaults', () => {
  expect(validateCall('saul_tabs_group', { tabIds: [0, Number.MAX_SAFE_INTEGER] })).toEqual({
    tabIds: [0, Number.MAX_SAFE_INTEGER],
  });
  expect(validateCall('saul_tabs_move', { tabIds: [1], windowId: 1, index: -1 })).toEqual({
    tabIds: [1],
    windowId: 1,
    index: -1,
  });
  for (const args of [
    { tabIds: [] },
    { tabIds: [1, 1] },
    { tabIds: [Number.MAX_SAFE_INTEGER + 1] },
    { tabIds: Array.from({ length: 1001 }, (_, i) => i) },
    { tabIds: [1], title: 'x'.repeat(201) },
    { tabIds: [1], color: 'unknown' },
    { tabIds: [1], dryRun: undefined },
    { tabIds: [1], dryRun: null },
    { tabIds: [1], session: 'wrong' },
    { tabIds: [1], extra: true },
  ])
    expect(() => validateCall('saul_tabs_group', args)).toThrow();
  const normalized = validateCall('saul_annotations', {
    session: undefined,
    scope: { ids: ['one'] },
    author: { kind: 'agent', name: 'Fixture' },
    operation: { action: 'read', id: 'one' },
  });
  expect(normalized).toEqual({
    scope: { ids: ['one'], urls: [] },
    author: { kind: 'agent', name: 'Fixture' },
    operation: { action: 'read', id: 'one', image: false },
  });
  for (const name of ['missing', 'constructor', '__proto__'])
    expect(() => validateCall(name)).toThrow('Unknown tool');
});

it('keeps transport commands private and derives advertised bounds from validators', () => {
  for (const name of [
    'saul_tabs_edit',
    'saul_tabs_undo',
    'saul_summary_open',
    'saul_summary_status',
  ]) {
    expect(TRANSPORT_TOOLS.some((tool) => tool.name === name)).toBe(true);
    expect(TOOLS.some((tool) => tool.name === name)).toBe(false);
  }
  const group = TOOLS.find((tool) => tool.name === 'saul_tabs_group')!;
  expect(group.inputSchema.additionalProperties).toBe(false);
  expect(group.inputSchema.properties?.tabIds).toMatchObject({
    minItems: 1,
    maxItems: 1000,
    uniqueItems: true,
  });
  expect(group.inputSchema.properties?.dryRun).toMatchObject({ type: 'boolean', default: true });
  expect(group.inputSchema.required).toEqual(['tabIds']);
});

it('retains workspace and diagnostic validation after removing the schema interpreter', () => {
  const session = 'a'.repeat(16);
  expect(appRequest('saul_workspace_show', {})).toEqual({ name: 'saul_workspace_show', args: {} });
  expect(
    appRequest('saul_workspace_propose', {
      session,
      revision: 'a'.repeat(64),
      summary: '',
      windows: [{ title: '', tabIds: [] }],
    }).args,
  ).not.toHaveProperty('deduplicate');
  for (const args of [
    { session, kind: 'group', revision: 'r' },
    { session, kind: 'group', interactionToken: 'token' },
    { session, kind: 'group', interactionToken: 'token', revision: 'r', tabIds: [1, 1] },
  ])
    expect(() => appRequest('saul_workspace_edit', args)).toThrow();
  expect(validateDiagnosticCall('diagnostics_events', {})).toEqual({});
  expect(validateDiagnosticCall('diagnostics_events', { limit: 20 })).toEqual({ limit: 20 });
  for (const limit of [0, 21, 1.5, null, undefined])
    expect(() => validateDiagnosticCall('diagnostics_events', { limit })).toThrow();
  const uuid = '11111111-1111-4111-8111-111111111111';
  const event = {
    id: uuid,
    session: uuid,
    interaction: uuid,
    time: '2026-11-17T',
    source: 'app',
    method: '',
    direction: '',
    phase: 'request',
    status: '',
    payload: { text: '', originalBytes: 0, redacted: false, truncated: false, omitted: false },
  };
  expect(eventSchema.parse(event)).toEqual(event);
  expect(() =>
    eventSchema.parse({ ...event, payload: { ...event.payload, extra: true } }),
  ).toThrow();
  expect(() => eventSchema.parse({ ...event, id: 'bad' })).toThrow();
});
