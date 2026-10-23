import { isRecord } from './value.mts';
import type { TabSnapshot, ToolName, ToolResults } from './protocol.mts';
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
        ['available', 'unavailable', 'unsupported'].includes(String(v.nativeNames.status)) &&
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
export function validateToolResult<K extends ToolName>(name: K, value: unknown): ToolResults[K] {
  let valid = false;
  if (name === 'saul_summary_status')
    valid =
      value === null ||
      (isRecord(value) && text(value.id) && integer(value.completed) && integer(value.total));
  else if (isRecord(value)) {
    switch (name) {
      case 'saul_sessions':
        valid = Array.isArray(value.sessions) && value.sessions.every(isSession);
        break;
      case 'saul_tabs_list':
        valid = isSnapshot(value);
        break;
      case 'saul_tabs_edit':
      case 'saul_tabs_undo':
        valid =
          isSnapshot(value.snapshot) && text(value.message) && optional(value.undoToken, text);
        break;
      case 'saul_summary_open':
        valid = text(value.id);
        break;
      case 'saul_windows_label':
        valid =
          flag(value.dryRun) &&
          Array.isArray(value.windows) &&
          value.windows.every((w) => isRecord(w) && integer(w.windowId) && text(w.title));
        break;
      case 'saul_page_read':
        valid =
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
          );
        break;
      case 'saul_page_act':
        valid =
          flag(value.dryRun) && text(value.action) && integer(value.elementId) && text(value.url);
        break;
      case 'saul_page_navigate':
        valid = flag(value.dryRun) && integer(value.tabId) && text(value.url);
        break;
      case 'saul_groups_update':
        valid =
          flag(value.dryRun) &&
          isSnapshot({ windows: [], tabs: [], groups: [value.before, value.group] });
        break;
      default:
        valid = flag(value.dryRun) && numbers(value.tabIds);
        if (name === 'saul_tabs_sort' || name === 'saul_tabs_move' || name === 'saul_tabs_group')
          valid &&= integer(value.windowId);
        if (name === 'saul_tabs_move') valid &&= integer(value.index);
        if (name === 'saul_windows_create') valid &&= optional(value.windowId, integer);
        if (name === 'saul_tabs_group')
          valid &&=
            optional(value.groupId, integer) &&
            optional(value.title, text) &&
            optional(value.collapsed, flag) &&
            optional(value.color, text);
    }
  }
  if (!valid) throw new Error(`Invalid browser result for ${name}`);
  return value as ToolResults[K];
}
