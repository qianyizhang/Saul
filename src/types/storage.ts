import type { SelectionSnapshot, ResolvedContext, UserSettings } from './index';

export type RunStatus =
  | 'queued'
  | 'running'
  | 'saving'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled';
export interface RunResult {
  id: string;
  status: RunStatus;
  responseRaw: string;
  error?: string;
  reason?: string;
  model: string;
  provider: string;
  createdAt: number;
  latencyMs?: number;
  viewedAt?: number;
}
export interface Passage {
  snapshot: SelectionSnapshot;
  bookmarked: boolean;
  latest: RunResult;
  completed?: RunResult;
  unread: boolean;
}
export interface RunInput {
  provider: UserSettings['activeProvider'];
  remote: Omit<UserSettings['openaiCompatible'], 'apiKey'>;
  local: UserSettings['chromeAi'];
  systemPrompt: string;
  userPrompt: string;
  context: ResolvedContext;
}
export interface QueuedRun {
  id: string;
  selectionId: string;
  pageUrl: string;
  input: RunInput;
}
export interface Submission {
  submissionId: string;
  snapshot: SelectionSnapshot;
  input: RunInput;
  regenerate: boolean;
}
export interface HistoryItem {
  bookmarked: boolean;
  selectionId: string;
  selectedText: string;
  pageTitle: string;
  pageUrl: string;
  responseRaw: string;
  model: string;
  provider: string;
  latencyMs?: number;
  createdAt: number;
  latest: RunResult;
  completed?: RunResult;
  unread: boolean;
}

export interface DbOperations {
  DB_SUBMIT: { payload: Submission; result: { passageId: string; run?: QueuedRun } };
  DB_RECOVER: { payload: undefined; result: void };
  DB_CLAIM: { payload: { runId: string }; result: boolean };
  DB_CHECKPOINT: { payload: { runId: string; raw: string }; result: void };
  DB_FINISH: {
    payload: {
      runId: string;
      raw: string;
      status: Extract<RunStatus, 'completed' | 'failed' | 'interrupted' | 'cancelled'>;
      error?: string;
      reason?: string;
      latencyMs: number;
    };
    result: boolean;
  };
  DB_SAVING: { payload: { runId: string }; result: boolean };
  DB_PAGE: { payload: { url: string }; result: Passage[] };
  DB_PASSAGE: { payload: { selectionId: string }; result: Passage | undefined };
  DB_CONTEXT: { payload: { selectionId: string }; result: ResolvedContext };
  DB_RUNS: { payload: { selectionId: string }; result: RunResult[] };
  DB_VIEW: { payload: { selectionId: string; runId: string }; result: void };
  DB_UNREAD: { payload: undefined; result: number };
  DB_GET_HISTORY: {
    payload: { limit?: number; offset?: number; searchQuery?: string; bookmarksOnly?: boolean };
    result: HistoryItem[];
  };
  DB_DELETE_SELECTION: { payload: { selectionId: string }; result: void };
  DB_SET_BOOKMARK: { payload: { selectionId: string; bookmarked: boolean }; result: void };
  DB_CLEAR_HISTORY: { payload: undefined; result: void };
  DB_EXPORT_MARKDOWN: { payload: undefined; result: string };
}
export type DbType = keyof DbOperations;
export type DbRequest<K extends DbType = DbType> = {
  [P in K]: { type: P; payload: DbOperations[P]['payload'] };
}[K];
export type DbCall = <K extends DbType>(
  message: DbRequest<K>,
) => Promise<DbOperations[K]['result']>;
export type Reply<T> = { success: true; result: T } | { success: false; error: string };
