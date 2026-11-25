import type {
  DbOperations,
  DbRequest,
  DbType,
  HistoryVisibility,
  HistoryItem,
} from '../../shared/protocol/history-types.ts';
import { request } from '../platform/chrome/messages';

export async function sendDbMessage<K extends DbType>(
  message: DbRequest<K>,
): Promise<DbOperations[K]['result']> {
  return request({ target: 'saul-workspace', message });
}
export const fetchHistory = (
  limit: number,
  cursor: string | undefined,
  searchQuery: string,
  bookmarksOnly: boolean,
  visibility: HistoryVisibility,
) =>
  sendDbMessage({
    type: 'DB_HISTORY_PAGE',
    payload: { limit, cursor, searchQuery, bookmarksOnly, visibility },
  });
export const restoreHistorySelection = ({ selectionId, revision }: HistoryItem) =>
  sendDbMessage({
    type: 'DB_RESTORE_SELECTION',
    payload: { selectionId, expectedRevision: revision },
  });
export const purgeHistorySelection = ({ selectionId, revision }: HistoryItem) =>
  sendDbMessage({
    type: 'DB_PURGE_SELECTION',
    payload: { selectionId, expectedRevision: revision },
  });
export const deleteHistorySelection = ({ selectionId, revision, latest }: HistoryItem) => {
  const stopRunId = ['queued', 'running', 'saving'].includes(latest.status) ? latest.id : undefined;
  return sendDbMessage({
    type: 'DB_DELETE_SELECTION',
    payload: { selectionId, expectedRevision: revision, stopRunId },
  });
};
export const clearAllHistory = () =>
  sendDbMessage({ type: 'DB_CLEAR_HISTORY', payload: undefined });
export const exportKnowledgeMarkdown = () =>
  sendDbMessage({ type: 'DB_EXPORT_MARKDOWN', payload: undefined });
export const setHistoryBookmark = ({ selectionId, revision, bookmarked }: HistoryItem) =>
  sendDbMessage({
    type: 'DB_SET_BOOKMARK',
    payload: { selectionId, bookmarked: !bookmarked, expectedRevision: revision },
  });
