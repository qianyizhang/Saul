import { saulDb } from './db';
import type { DbMessage } from '../types/storage';

async function execute(message: DbMessage) {
  switch (message.type) {
    case 'DB_SAVE_RECORD':
      await saulDb.saveRecord(message.payload);
      return { success: true };
    case 'DB_GET_HISTORY':
      return {
        success: true,
        history: await saulDb.getHistory(
          message.payload.limit,
          message.payload.offset,
          message.payload.searchQuery,
          message.payload.bookmarksOnly,
        ),
      };
    case 'DB_SET_BOOKMARK':
      await saulDb.setBookmark(message.payload.selectionId, message.payload.bookmarked);
      return { success: true };
    case 'DB_DELETE_SELECTION':
      await saulDb.deleteSelection(message.payload.selectionId);
      return { success: true };
    case 'DB_CLEAR_HISTORY':
      await saulDb.clearAll();
      return { success: true };
    case 'DB_EXPORT_MARKDOWN':
      return { success: true, markdown: await saulDb.exportToMarkdown() };
    default:
      throw new Error('Unknown database operation');
  }
}

// Serialize requests, including startup, so reads observe preceding writes.
let queue = Promise.resolve();
self.onmessage = ({ data }: MessageEvent<{ id: number; message: DbMessage }>) => {
  queue = queue.then(async () => {
    try {
      self.postMessage({ id: data.id, response: await execute(data.message) });
    } catch (error) {
      self.postMessage({
        id: data.id,
        response: {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });
};
