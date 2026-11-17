import { isRecord } from '../model/value.mts';
import { validAnnotationResult } from './protocol.mts';
import type { TabSnapshot, ToolArgs, ToolName, ToolResults } from './protocol.mts';
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const text = (v: unknown): v is string => typeof v === 'string';
const flag = (v: unknown): v is boolean => typeof v === 'boolean';
const numbers = (v: unknown): v is number[] => Array.isArray(v) && v.every(integer);
const optional = (v: unknown, check: (v: unknown) => boolean) => v === undefined || check(v);
export function isSnapshot(v: unknown): v is TabSnapshot {
  return (
    isRecord(v) &&
    Array.isArray(v.windows) &&
    v.windows.every(
      (w) => isRecord(w) && integer(w.id) && flag(w.focused) && optional(w.title, text),
    ) &&
    Array.isArray(v.tabs) &&
    v.tabs.every(
      (t) =>
        isRecord(t) &&
        ['id', 'windowId', 'index', 'groupId'].every((k) => integer(t[k])) &&
        ['title', 'url'].every((k) => text(t[k])) &&
        ['active', 'pinned', 'audible', 'discarded'].every((k) => flag(t[k])),
    ) &&
    Array.isArray(v.groups) &&
    v.groups.every(
      (g) =>
        isRecord(g) &&
        integer(g.id) &&
        integer(g.windowId) &&
        optional(g.title, text) &&
        typeof g.color === 'string' &&
        ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'].includes(
          g.color,
        ) &&
        flag(g.collapsed),
    ) &&
    (v.nativeNames === undefined ||
      (isRecord(v.nativeNames) &&
        typeof v.nativeNames.status === 'string' &&
        ['available', 'unavailable', 'unsupported'].includes(v.nativeNames.status) &&
        optional(v.nativeNames.message, text)))
  );
}
export function isSession(
  v: unknown,
): v is ToolResults['saul_sessions']['sessions'][number] & { browserPid?: number } {
  return (
    isRecord(v) &&
    text(v.session) &&
    text(v.extensionId) &&
    integer(v.pid) &&
    text(v.connectedAt) &&
    optional(v.browserPid, integer)
  );
}
const record = (check: (value: Record<string, unknown>) => boolean) => (value: unknown) =>
  isRecord(value) && check(value);
const tabResult = (value: Record<string, unknown>) => flag(value.dryRun) && numbers(value.tabIds);
const windowTabResult = (value: Record<string, unknown>) =>
  tabResult(value) && integer(value.windowId);
const tabEdit = record(
  (value) => isSnapshot(value.snapshot) && text(value.message) && optional(value.undoToken, text),
);

const validators: { [K in ToolName]: (value: unknown, args?: ToolArgs[K]) => boolean } = {
  saul_annotations: (value, args) => validAnnotationResult(value, args?.operation),
  saul_sessions: record(
    (value) => Array.isArray(value.sessions) && value.sessions.every(isSession),
  ),
  saul_tabs_list: isSnapshot,
  saul_tabs_edit: tabEdit,
  saul_tabs_undo: tabEdit,
  saul_summary_open: record((value) => text(value.id)),
  saul_summary_status: (value) =>
    value === null ||
    (isRecord(value) && text(value.id) && integer(value.completed) && integer(value.total)),
  saul_windows_label: record(
    (value) =>
      flag(value.dryRun) &&
      Array.isArray(value.windows) &&
      value.windows.every((w) => isRecord(w) && integer(w.windowId) && text(w.title)),
  ),
  saul_page_read: record(
    (value) =>
      ['url', 'title', 'text', 'snapshotId', 'documentId'].every((k) => text(value[k])) &&
      flag(value.truncated) &&
      flag(value.elementsTruncated) &&
      Array.isArray(value.elements) &&
      value.elements.every(
        (e) =>
          isRecord(e) &&
          integer(e.elementId) &&
          ['tag', 'label', 'type'].every((k) => text(e[k])) &&
          optional(e.href, text),
      ),
  ),
  saul_page_act: record(
    (value) =>
      flag(value.dryRun) && text(value.action) && integer(value.elementId) && text(value.url),
  ),
  saul_page_navigate: record(
    (value) => flag(value.dryRun) && integer(value.tabId) && text(value.url),
  ),
  saul_groups_update: record(
    (value) =>
      flag(value.dryRun) &&
      isSnapshot({ windows: [], tabs: [], groups: [value.before, value.group] }),
  ),
  saul_tabs_close_duplicates: record(tabResult),
  saul_tabs_ungroup: record(tabResult),
  saul_tabs_sort: record(windowTabResult),
  saul_tabs_move: record((value) => windowTabResult(value) && integer(value.index)),
  saul_windows_create: record((value) => tabResult(value) && optional(value.windowId, integer)),
  saul_tabs_group: record(
    (value) =>
      windowTabResult(value) &&
      optional(value.groupId, integer) &&
      optional(value.title, text) &&
      optional(value.collapsed, flag) &&
      optional(value.color, text),
  ),
};

export function validateToolResult<K extends ToolName>(
  name: K,
  value: unknown,
  args?: ToolArgs[K],
): ToolResults[K] {
  if (!validators[name](value, args)) throw new Error(`Invalid browser result for ${name}`);
  return value as ToolResults[K];
}
