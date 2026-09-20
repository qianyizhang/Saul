import type { DbOperations, DbRequest, DbType, Reply, Submission } from '../types/storage';

let creatingOffscreen: Promise<void> | null = null;
export async function ensureOffscreenDocument(): Promise<void> {
  if (!chrome.offscreen) throw new Error('Offscreen storage requires Chrome.');
  if (creatingOffscreen) return creatingOffscreen;
  creatingOffscreen = (async () => {
    if (await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Persistent reading jobs and SQLite worker',
    });
  })();
  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}
export async function request<T>(message: unknown): Promise<T> {
  const reply: Reply<T> | undefined = await chrome.runtime.sendMessage(message);
  if (!reply) throw new Error('Saul did not respond. Reload the extension and retry.');
  if (!reply.success) throw new Error(reply.error);
  return reply.result;
}
export type RunnerRequest =
  | { operation: 'db'; message: DbRequest }
  | { operation: 'submit'; submission: Submission; credential: string }
  | { operation: 'stop'; selectionId: string }
  | { operation: 'delete'; selectionId?: string };
export async function runnerRequest<T>(message: RunnerRequest): Promise<T> {
  await ensureOffscreenDocument();
  return request<T>({ target: 'saul-offscreen', ...message });
}
export async function sendDbMessage<K extends DbType>(
  message: DbRequest<K>,
): Promise<DbOperations[K]['result']> {
  return request({ target: 'saul-workspace', message });
}
export const fetchHistory = (limit = 50, offset = 0, searchQuery?: string, bookmarksOnly = false) =>
  sendDbMessage({ type: 'DB_GET_HISTORY', payload: { limit, offset, searchQuery, bookmarksOnly } });
export const deleteHistorySelection = (selectionId: string) =>
  sendDbMessage({ type: 'DB_DELETE_SELECTION', payload: { selectionId } });
export const clearAllHistory = () =>
  sendDbMessage({ type: 'DB_CLEAR_HISTORY', payload: undefined });
export const exportKnowledgeMarkdown = () =>
  sendDbMessage({ type: 'DB_EXPORT_MARKDOWN', payload: undefined });
export const setHistoryBookmark = (selectionId: string, bookmarked: boolean) =>
  sendDbMessage({ type: 'DB_SET_BOOKMARK', payload: { selectionId, bookmarked } });
