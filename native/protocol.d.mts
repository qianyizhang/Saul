export const HOST_NAME: string;
export const MAX_MESSAGE: number;
export type GroupColor =
  | 'grey'
  | 'blue'
  | 'red'
  | 'yellow'
  | 'green'
  | 'pink'
  | 'purple'
  | 'cyan'
  | 'orange';
export interface GroupMetadata {
  title?: string;
  color?: GroupColor;
  collapsed?: boolean;
}
interface Common {
  session?: string;
}
interface Mutation extends Common {
  dryRun?: boolean;
}
export interface ToolArgs {
  saul_windows_create: Mutation & { tabIds: number[]; focused?: boolean };
  saul_page_read: Common & { tabId: number };
  saul_page_act: Mutation & {
    tabId: number;
    documentId: string;
    snapshotId: string;
    elementId: number;
    action: 'click' | 'fill';
    value?: string;
  };
  saul_page_navigate: Mutation & { tabId: number; expectedUrl: string; url: string };
  saul_sessions: Record<string, never>;
  saul_tabs_list: Common & { windowId?: number };
  saul_tabs_sort: Mutation & { windowId: number; by: 'title' | 'domain'; descending?: boolean };
  saul_tabs_group: Mutation & GroupMetadata & { tabIds: number[]; groupId?: number };
  saul_tabs_ungroup: Mutation & { tabIds: number[] };
  saul_tabs_move: Mutation & { tabIds: number[]; windowId: number; index: number };
  saul_groups_update: Mutation & GroupMetadata & { groupId: number };
}
export type ToolName = keyof ToolArgs;
export type BrowserTool = Exclude<ToolName, 'saul_sessions'>;
export const CLI_COMMANDS: Readonly<Record<string, ToolName>>;
export interface TabView {
  id: number;
  windowId: number;
  index: number;
  title: string;
  url: string;
  active: boolean;
  pinned: boolean;
  groupId: number;
  audible: boolean;
  discarded: boolean;
}
export interface GroupView {
  id: number;
  windowId: number;
  title?: string;
  color: GroupColor;
  collapsed: boolean;
}
export interface TabSnapshot {
  windows: { id: number; focused: boolean; title?: string }[];
  tabs: TabView[];
  groups: GroupView[];
}
export interface PageSnapshot {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  snapshotId: string;
  documentId: string;
  elements: { elementId: number; tag: string; label: string; type: string; href?: string }[];
  elementsTruncated: boolean;
}
export interface ToolResults {
  saul_windows_create: { dryRun: boolean; tabIds: number[]; windowId?: number };
  saul_page_read: PageSnapshot;
  saul_page_act: { dryRun: boolean; action: string; elementId: number; url: string };
  saul_page_navigate: { dryRun: boolean; tabId: number; url: string };
  saul_sessions: {
    sessions: { session: string; extensionId: string; pid: number; connectedAt: string }[];
  };
  saul_tabs_list: TabSnapshot;
  saul_tabs_sort: { dryRun: boolean; windowId: number; tabIds: number[] };
  saul_tabs_group: {
    dryRun: boolean;
    tabIds: number[];
    windowId: number;
    groupId?: number;
  } & GroupMetadata;
  saul_tabs_ungroup: { dryRun: boolean; tabIds: number[] };
  saul_tabs_move: { dryRun: boolean; tabIds: number[]; windowId: number; index: number };
  saul_groups_update: { dryRun: boolean; before: GroupView; group: GroupView };
}
export interface ToolSchema {
  type: string;
  properties?: Record<string, ToolSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: ToolSchema;
  enum?: readonly (string | number)[];
  minimum?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  default?: unknown;
  description?: string;
}
export const TOOLS: {
  name: ToolName;
  description: string;
  inputSchema: ToolSchema;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: boolean };
}[];
export function validateCall<K extends ToolName>(name: K, args?: unknown): ToolArgs[K];
export function validateCall(name: string, args?: unknown): ToolArgs[ToolName];
export function validate(schema: ToolSchema, value: unknown, path: string): void;
