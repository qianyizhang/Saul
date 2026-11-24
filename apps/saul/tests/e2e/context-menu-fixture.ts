// The native Chrome menu is outside Playwright's page controls. Capture the
// actual production listeners and dispatch the same event in the test worker.
const listeners: Parameters<typeof chrome.contextMenus.onClicked.addListener>[0][] = [];
const addListener = chrome.contextMenus.onClicked.addListener.bind(chrome.contextMenus.onClicked);
chrome.contextMenus.onClicked.addListener = (listener) => {
  listeners.push(listener);
  addListener(listener);
};
Object.assign(globalThis, {
  async saulFixtureContextMenu(menuItemId: string, tabId: number) {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) throw new Error('Fixture tab has no URL');
    for (const listener of listeners)
      listener({ menuItemId, pageUrl: tab.url, editable: false }, tab);
  },
});
