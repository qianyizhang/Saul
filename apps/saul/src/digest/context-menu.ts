import { openSummaryReader } from './reader';

export const SUMMARY_MENU_ID = 'saul-summarize';

export function initSummaryContextMenu() {
  chrome.runtime.onInstalled.addListener(() => {
    void chrome.contextMenus
      .removeAll()
      .then(() => {
        chrome.contextMenus.create(
          {
            id: SUMMARY_MENU_ID,
            title: 'Saul Summarize',
            contexts: ['page', 'selection', 'link', 'image', 'video', 'audio'],
            documentUrlPatterns: ['http://*/*', 'https://*/*'],
          },
          () => {
            if (chrome.runtime.lastError)
              console.warn(
                '[Saul] Could not register summary menu',
                chrome.runtime.lastError.message,
              );
          },
        );
      })
      .catch((error) => console.warn('[Saul] Could not register summary menu', error));
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== SUMMARY_MENU_ID || tab?.id === undefined || tab.incognito) return;
    void openSummaryReader({ tabIds: [tab.id] }).catch((error) =>
      console.warn('[Saul] Could not open summary reader', error),
    );
  });
}
