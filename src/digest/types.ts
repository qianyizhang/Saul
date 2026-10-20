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
export interface DigestSource {
  text: string;
  capturedAt: number;
  truncated: boolean;
  coverage: string;
}
export interface DigestItem {
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
}
export interface DigestMeta {
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
export interface DigestOperations {
  start: {
    request: { action: 'start'; id: string; tabIds: number[]; accountId: string };
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
