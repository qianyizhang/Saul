export interface Pair {
  en: string;
  zh: string;
}
export interface Summary {
  lead: Pair;
  points: Pair[];
  caution: Pair | null;
  flow: Pair[];
  terms: Pair[];
  question: Pair | null;
}
export type ItemStatus =
  | 'queued'
  | 'capturing'
  | 'running'
  | 'saving'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled'
  | 'skipped';
export type PdfProcessing = 'attachment' | 'local';
interface SourceMeta {
  title?: string;
  capturedAt: number;
  truncated: boolean;
  coverage: string;
}
export interface DigestTextSource extends SourceMeta {
  kind?: 'text'; // Existing persisted text captures have no discriminant.
  text: string;
}
export interface DigestPdfSource extends SourceMeta {
  kind: 'pdf-url';
  attachment: import('../protocol/credential-plan.mts').PdfUrlAttachment;
}
export type DigestSource = DigestTextSource | DigestPdfSource;
// Local PDF bytes stay in the offscreen document; messages carry only this target.
export type DigestCapture =
  DigestTextSource | { pdf: { url: string; title?: string; unverified?: boolean } };
export interface DigestItem {
  maskedAt?: number;
  finalText?: string;
  progress?: string;
  calls?: import('./call-output.ts').CallSnapshot['calls'];
  index: number;
  tabId: number;
  windowId?: number;
  windowTitle?: string;
  title: string;
  url: string;
  status: ItemStatus;
  raw: string;
  summary?: Summary;
  error?: string;
  coverage?: string;
  truncated?: boolean;
  capturedAt?: number;
  sourceKind?: 'pdf-url';
}
export type DigestMeta = {
  id: string;
  windowTitle: string;
  windowId: number;
  createdAt: number;
  pdfProcessing?: PdfProcessing; // Missing on old batches means local parsing.
  // Pre-preset Summarize rows keep their frozen route in these fields.
  accountId?: string;
  connectionKey?: string;
  credentialOwner?: 'local' | 'saul';
  model?: string;
  effort?: string;
} & (
  | {
      action: import('./custom-call.ts').FrozenCustomCall;
      summaryInput?: undefined;
      prompt?: string;
    }
  | {
      action?: undefined;
      summaryInput?: import('./execution-route.ts').FrozenModel;
      prompt: string;
    }
);
// Existing storage helpers report absence with this wire error.
export const MISSING_CALL_BATCH = 'This digest no longer exists.';
export type DigestBatch = DigestMeta & {
  maskedAt?: number;
  error?: string;
  items: DigestItem[];
};
export type DigestOverview = Pick<DigestMeta, 'id' | 'windowTitle' | 'createdAt'> & {
  maskedAt?: number;
  title?: string; // Older history helpers return only the window label.
};

export function summaryTitle(first: Pick<DigestItem, 'title' | 'url'> | undefined, count: number) {
  let title = first?.title.trim();
  if ((!title || title === 'Untitled tab') && first) {
    const source = URL.parse(first.url);
    title = source?.hostname || undefined;
  }
  if (!title) return count > 1 ? `${count} pages` : 'Page summary';
  return count > 1 ? `${title} + ${count - 1} more` : title;
}
export interface DigestComparison {
  index: number;
  text?: import('./text-change.ts').TextChange;
  fields: string[];
  error?: string;
  checkedAt?: number;
  notice?: string;
}
export interface DigestInspection {
  saved?: DigestSource;
  current?: DigestSource;
  comparison?: DigestComparison;
}
export interface DigestResolution {
  batch?: DigestBatch;
  comparisons: DigestComparison[];
}
export interface DigestOperations {
  resolve: {
    request: { action: 'resolve'; id: string };
    result: DigestResolution;
  };
  inspect: {
    request: { action: 'inspect'; id: string; index: number; tabId?: number };
    result: DigestInspection;
  };
  start: {
    request: {
      action: 'start';
      id: string;
      regenerate?: boolean;
    };
    result: DigestBatch;
  };
  active: { request: { action: 'active' }; result: DigestBatch | undefined };
  list: { request: { action: 'list' }; result: DigestOverview[] };
  get: { request: { action: 'get'; id: string }; result: DigestBatch };
  stop: { request: { action: 'stop'; id: string }; result: DigestBatch };
  retry: { request: { action: 'retry'; id: string }; result: DigestBatch };
  delete: { request: { action: 'delete'; id: string }; result: void };
}
export type DigestRequest = DigestOperations[keyof DigestOperations]['request'];
export type DigestResult<T extends DigestRequest> = DigestOperations[T['action']]['result'];
export type CallControl = Exclude<DigestRequest, { action: 'start' | 'resolve' }>;
export type CallLookup = Pick<DigestBatch, 'items' | 'action' | 'pdfProcessing'> & {
  currentModel?: import('./execution-route.ts').FrozenModel | null;
};

export interface CallLaunch {
  id: string;
  tabIds: number[];
  previousBatchId?: string;
  review?: { stamp: string; presetId?: string };
}
export type CallLaunchResult =
  | { kind: 'started' | 'reused'; batch: DigestBatch; comparisons: DigestComparison[] }
  | {
      kind: 'setup';
      reason: 'choose' | 'repair' | 'changed';
      stamp: string;
      message: string;
      presets: { id: string; name: string }[];
      presetId?: string;
      presetName?: string;
      reviewSources?: { title: string; url: string }[];
      routeLabel?: string;
      source: { title: string; url: string };
    };
export const activeItem = (item: DigestItem) =>
  ['queued', 'capturing', 'running', 'saving'].includes(item.status);

export interface DigestDbOperations {
  DB_DIGEST_ITEMS_PAGE: {
    payload: { id: string; limit?: number; cursor?: string };
    result: { items: DigestItem[]; cursor?: string };
  };
  DB_DIGEST_ACTION_REVISIONS: { payload: undefined; result: string[] };
  DB_DIGEST_FIND: {
    payload: { urls: string[]; actionRevision?: string; actionPresetId?: string };
    result: DigestBatch | undefined;
  };
  DB_DIGEST_CREATE: { payload: DigestBatch; result: DigestBatch };
  DB_DIGEST_GET: { payload: { id: string }; result: DigestBatch };
  DB_DIGEST_RETRY: { payload: { id: string }; result: DigestBatch };
  DB_DIGEST_INTERRUPT: { payload: { id: string; error: string }; result: DigestBatch };
  DB_DIGEST_LIST: { payload: undefined; result: DigestOverview[] };
  DB_DIGEST_ITEM: {
    payload: { id: string; item: DigestItem; source?: DigestSource };
    result: void;
  };
  DB_DIGEST_SOURCE: { payload: { id: string; index: number }; result: DigestSource | undefined };
  DB_DIGEST_RECOVER: { payload: undefined; result: void };
  DB_DIGEST_DELETE: { payload: { id: string }; result: void };
}

export const retryableItem = (item: DigestItem) =>
  activeItem(item) || ['failed', 'interrupted', 'cancelled'].includes(item.status);

export function restartItem(item: DigestItem): DigestItem {
  const next = { ...item, status: 'queued' as const, raw: '' };
  delete next.error;
  delete next.summary;
  delete next.finalText;
  delete next.calls;
  delete next.progress;
  return next;
}

export function interruptItem(item: DigestItem, error: string): DigestItem {
  const next = { ...item, status: 'interrupted' as const, error };
  delete next.summary;
  delete next.finalText;
  delete next.progress;
  return next;
}
