export interface WindowNameTarget {
  windowId: number;
  tabIds: number[];
  expectedTitle?: string;
}

export type WindowNameRequest = { browserPid: number } & (
  | { action: 'read'; windows: (WindowNameTarget & { title?: string })[] }
  | { action: 'apply'; windows: (WindowNameTarget & { title: string })[] }
);

export type WindowNameReply = { windowId: number; title: string }[];
