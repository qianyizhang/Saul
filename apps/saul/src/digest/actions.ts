import { closeSummaryPanel, openSummaryPanel } from './panel';

export const SUMMARY_ACTION_ID = 'saul-summarize';
export const SUMMARY_CLOSE_ID = 'saul-summary-close';

function summarizeTab(tab?: chrome.tabs.Tab) {
  if (tab?.id === undefined || tab.incognito || !/^https?:\/\//.test(tab.url || '')) return;
  void openSummaryPanel(tab.windowId, { tabIds: [tab.id] }).catch((error) =>
    console.warn('[Saul] Could not open summary reader', error),
  );
}

export function initSummaryActions() {
  chrome.runtime.onInstalled.addListener(() => {
    void chrome.contextMenus
      .removeAll()
      .then(() => {
        chrome.contextMenus.create(
          {
            id: SUMMARY_ACTION_ID,
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
    if (info.menuItemId === SUMMARY_ACTION_ID) summarizeTab(tab);
  });
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === SUMMARY_ACTION_ID) summarizeTab(tab);
    if (command === SUMMARY_CLOSE_ID && tab && !tab.incognito)
      void closeSummaryPanel(tab.windowId).catch((error) =>
        console.warn('[Saul] Could not close summary panel', error),
      );
  });
}
