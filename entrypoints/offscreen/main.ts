import { saulDb } from '../../src/storage/db';
import type { DbMessage } from '../../src/types/storage';

console.log('[Saul Offscreen] Initializing SQLite database runtime...');

saulDb
  .init()
  .then(() => {
    console.log('[Saul Offscreen] SQLite WASM Database ready');
  })
  .catch((err) => {
    console.error('[Saul Offscreen] SQLite init error:', err);
  });

// Handle DB messages from background or popup
chrome.runtime.onMessage.addListener((message: DbMessage, sender, sendResponse) => {
  if (!message || !message.type || !message.type.startsWith('DB_')) {
    return false;
  }

  (async () => {
    try {
      if (message.type === 'DB_SAVE_RECORD') {
        await saulDb.saveRecord(message.payload);
        sendResponse({ success: true });
      } else if (message.type === 'DB_GET_HISTORY') {
        const history = await saulDb.getHistory(
          message.payload.limit,
          message.payload.offset,
          message.payload.searchQuery
        );
        sendResponse({ success: true, history });
      } else if (message.type === 'DB_DELETE_SELECTION') {
        await saulDb.deleteSelection(message.payload.selectionId);
        sendResponse({ success: true });
      } else if (message.type === 'DB_CLEAR_HISTORY') {
        await saulDb.clearAll();
        sendResponse({ success: true });
      } else if (message.type === 'DB_EXPORT_MARKDOWN') {
        const markdown = await saulDb.exportToMarkdown();
        sendResponse({ success: true, markdown });
      } else {
        sendResponse({ success: false, error: 'Unknown DB message type' });
      }
    } catch (err: any) {
      console.error('[Saul Offscreen] Error executing DB action:', err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true; // Keep message channel open for async response
});
