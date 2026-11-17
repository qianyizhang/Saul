export function workspaceSender(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    !!sender.url &&
    ['popup.html', 'library.html', 'summary-panel.html'].some(
      (path) => sender.url!.split(/[?#]/)[0] === chrome.runtime.getURL(path),
    )
  );
}
export function backgroundSender(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    !sender.tab &&
    (!sender.url || sender.url === chrome.runtime.getURL('background.js'))
  );
}
export function offscreenSender(sender: chrome.runtime.MessageSender | undefined): boolean {
  return (
    sender?.id === chrome.runtime.id &&
    !sender.tab &&
    sender.url === chrome.runtime.getURL('offscreen.html')
  );
}
export function sourcePage(sender: chrome.runtime.MessageSender): string {
  if (
    sender.id !== chrome.runtime.id ||
    sender.tab?.id === undefined ||
    sender.frameId !== 0 ||
    !sender.url ||
    !/^https?:/.test(sender.url) ||
    !sender.tab.url ||
    !/^https?:/.test(sender.tab.url) ||
    new URL(sender.tab.url).origin !== new URL(sender.url).origin
  )
    throw new Error('Reading requests require a source page');
  // Chrome keeps sender.url at the document's initial URL after pushState.
  // The browser-supplied main-frame tab URL tracks its current route.
  return sender.tab.url;
}
