import { closeSummaryPanel, openSummaryPanel } from './panel-route';
import { DEEP_DIVE_LABEL, DEEP_DIVE_MENU } from '../deep-dives/model';

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
        const items: chrome.contextMenus.CreateProperties[] = [
          {
            id: SUMMARY_ACTION_ID,
            title: 'Call Saul',
            contexts: ['page', 'selection', 'link', 'image', 'video', 'audio'],
          },
          {
            id: DEEP_DIVE_MENU,
            title: DEEP_DIVE_LABEL,
            contexts: ['page', 'selection', 'link', 'image', 'video', 'audio'],
          },
        ];
        for (const item of items) {
          chrome.contextMenus.create(
            { ...item, documentUrlPatterns: ['http://*/*', 'https://*/*'] },
            () => {
              if (chrome.runtime.lastError)
                console.warn(
                  '[Saul] Could not register page menu',
                  item.id,
                  chrome.runtime.lastError.message,
                );
            },
          );
        }
      })
      .catch((error) => console.warn('[Saul] Could not register page menus', error));
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
