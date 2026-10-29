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
  attachment: import('../../native/plan-protocol.mts').PdfUrlAttachment;
}
export type DigestSource = DigestTextSource | DigestPdfSource;
// Local PDF bytes stay in the offscreen document; messages carry only this target.
export type DigestCapture =
  | DigestTextSource
  | { pdf: { url: string; title?: string; unverified?: boolean } };
export interface DigestItem {
  finalText?: string;
  progress?: string;
  calls?: { instructions: string; input: string; output: string; complete: boolean }[];
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
export interface DigestMeta {
  action?: import('../actions/contract').FrozenAction;
  pdfProcessing?: PdfProcessing; // Missing on old batches means local parsing.
  id: string;
  windowTitle: string;
  windowId: number;
  accountId: string;
  createdAt: number;
  prompt: string;
  model: 'gpt-6-luna';
  effort: 'medium';
}
export interface DigestBatch extends DigestMeta {
  error?: string;
  items: DigestItem[];
}
export type DigestOverview = Pick<DigestMeta, 'id' | 'windowTitle' | 'createdAt'>;
export interface DigestComparison {
  index: number;
  text?: import('../reading/input-change').TextChange;
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
    request: { action: 'resolve'; id: string; tabIds: number[] };
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
      tabIds: number[];
      accountId: string;
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
export const activeItem = (item: DigestItem) =>
  ['queued', 'capturing', 'running'].includes(item.status);

export interface DigestDbOperations {
  DB_DIGEST_ACTION_REVISIONS: { payload: undefined; result: string[] };
  DB_DIGEST_FIND: {
    payload: { urls: string[]; actionRevision?: string; actionPresetId?: string };
    result: DigestBatch | undefined;
  };
  DB_DIGEST_CREATE: { payload: DigestBatch; result: DigestBatch };
  DB_DIGEST_GET: { payload: { id: string }; result: DigestBatch };
  DB_DIGEST_LIST: { payload: undefined; result: DigestOverview[] };
  DB_DIGEST_ITEM: {
    payload: { id: string; item: DigestItem; source?: DigestSource };
    result: void;
  };
  DB_DIGEST_SOURCE: { payload: { id: string; index: number }; result: DigestSource | undefined };
  DB_DIGEST_RECOVER: { payload: undefined; result: void };
  DB_DIGEST_DELETE: { payload: { id: string }; result: void };
}
