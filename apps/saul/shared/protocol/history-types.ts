import type { LibraryToolOperations } from './history-tools.mts';
import type { ReadingHistoryOperations } from './reading-history.mts';
import type { AnnotationDbOperations } from './annotation-attempts.ts';
import type { ModelActivity } from '../model/model-events.ts';
import type { DigestDbOperations } from '../model/call-batch.ts';
import type { SelectionSnapshot, ResolvedContext } from '../model/reading.ts';
import type { Recipe, ModelPreset } from '../model/presets.ts';

export type RunStatus =
  'queued' | 'running' | 'saving' | ReadingHistoryOperations['DB_FINISH']['payload']['status'];
export interface RunResult {
  id: string;
  status: RunStatus;
  responseRaw: string;
  hasImage?: boolean;
  capability?: 'write' | 'draw' | 'speak';
  imageOptions?: import('./shared-presets-contract.mts').SharedImageOptions;
  maskedAt?: number;
  /** Live runner state only; never inferred from elapsed time or persisted. */
  activity?: ModelActivity;
  error?: string;
  reason?: string;
  model: string;
  provider: string;
  createdAt: number;
  latencyMs?: number;
  viewedAt?: number;
  recipe?: Pick<Recipe, 'id' | 'name'>;
  preset?: Pick<ModelPreset, 'id' | 'name'>;
  inspection?: Pick<RunInput, 'systemPrompt' | 'userPrompt' | 'context' | 'followUpQuestion'>;
}
export interface Passage {
  revision?: number;
  snapshot: SelectionSnapshot;
  bookmarked: boolean;
  latest: RunResult;
  completed?: RunResult;
  unread: boolean;
}
export type Submission = ReadingHistoryOperations['DB_SUBMIT']['payload'];
export type RunInput = Submission['input'];
export type QueuedRun = NonNullable<ReadingHistoryOperations['DB_SUBMIT']['result']['run']>;
export type HistoryVisibility = 'visible' | 'masked' | 'all';
export interface HistoryItem {
  maskedAt?: number;
  revision?: number;
  hasImage?: boolean;
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

export interface DbOperations
  extends
    LibraryToolOperations,
    DigestDbOperations,
    AnnotationDbOperations,
    ReadingHistoryOperations {
  DB_IMAGE: {
    payload: { selectionId: string; runId?: string };
    result: import('../model/image.ts').GeneratedImage | undefined;
  };
  DB_IMAGE_CHUNK: {
    payload: {
      runId: string;
      offset: number;
      data: string;
      mediaType: 'image/png' | 'image/gif';
      last: boolean;
    };
    result: void;
  };
  DB_READING_RESOLVE: {
    payload: { snapshot: SelectionSnapshot; submissionId: string; recipeId: string };
    result: string | undefined;
  };
  DB_RECOVER: { payload: undefined; result: void };
  DB_PAGE: { payload: { url: string }; result: Passage[] };
  DB_PASSAGE: { payload: { selectionId: string }; result: Passage | undefined };
  DB_CONTEXT: { payload: { selectionId: string; runId?: string }; result: ResolvedContext };
  DB_INPUT: { payload: { selectionId: string; runId?: string }; result: RunInput | undefined };
  DB_READING_ATTEMPTS_PAGE: {
    payload: { selectionId: string; limit?: number; cursor?: string };
    result: { items: RunResult[]; cursor?: string };
  };
  DB_RUNS: { payload: { selectionId: string }; result: RunResult[] };
  DB_VIEW: { payload: { selectionId: string; runId: string }; result: void };
  DB_UNREAD: { payload: undefined; result: number };
  DB_GET_HISTORY: {
    payload: { limit?: number; offset?: number; searchQuery?: string; bookmarksOnly?: boolean };
    result: HistoryItem[];
  };
  DB_HISTORY_PAGE: {
    payload: {
      limit?: number;
      cursor?: string;
      searchQuery?: string;
      bookmarksOnly?: boolean;
      visibility?: HistoryVisibility;
    };
    result: { items: HistoryItem[]; cursor?: string };
  };
  DB_RESTORE_SELECTION: {
    payload: { selectionId: string; expectedRevision?: number };
    result: void;
  };
  DB_PURGE_SELECTION: { payload: { selectionId: string; expectedRevision?: number }; result: void };
  DB_DELETE_SELECTION: {
    payload: { selectionId: string; expectedRevision?: number; stopRunId?: string };
    result: void;
  };
  DB_SET_BOOKMARK: {
    payload: { selectionId: string; bookmarked: boolean; expectedRevision?: number };
    result: void;
  };
  DB_CLEAR_HISTORY: { payload: undefined; result: void };
  DB_EXPORT_MARKDOWN: { payload: undefined; result: string };
}
export type DbType = keyof DbOperations;
export type DbRequest<K extends DbType = DbType> = {
  [P in K]: { type: P; payload: DbOperations[P]['payload'] };
}[K];
export type DbCall<Allowed extends DbType = DbType> = <K extends Allowed>(
  message: DbRequest<K>,
) => Promise<DbOperations[K]['result']>;
export type Reply<T> = { success: true; result: T } | { success: false; error: string };
