import type { DbOperations, DbRequest, DbType } from '../../shared/protocol/history-types.ts';
import { request } from '../platform/chrome/messages';

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
