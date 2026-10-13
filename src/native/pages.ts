import { validateCall, type ToolResults } from '../../native/protocol.mjs';

export const PAGE_ACCESS_KEY = 'saul_native_page_enabled';
type PageResult = ToolResults['saul_page_read' | 'saul_page_act' | 'saul_page_navigate'];

// Serialized into Chrome's isolated world. Keep this function self-contained.
function pageOperation(input: {
  snapshotId?: string;
  elementId?: number;
  action?: 'click' | 'fill';
  value?: string;
  dryRun?: boolean;
}) {
  try {
    type Entry = { element: HTMLElement; fingerprint: string };
    const state = globalThis as typeof globalThis & {
      __saulPageSnapshot?: { id: string; url: string; at: number; entries: Entry[] };
    };
    const visible = (element: HTMLElement) =>
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility === 'visible' &&
      !element.closest('[inert], [aria-hidden="true"]');
    const fingerprint = (element: HTMLElement) => element.outerHTML;
    if (!input.action) {
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          'a[href],button,input,textarea,select,[role="button"]',
        ),
      ).filter(visible);
      const entries = candidates
        .slice(0, 100)
        .map((element) => ({ element, fingerprint: fingerprint(element) }));
      const snapshot = { id: crypto.randomUUID(), url: location.href, at: Date.now(), entries };
      state.__saulPageSnapshot = snapshot;
      const text = document.body?.innerText ?? '';
      return {
        url: location.href,
        title: document.title.slice(0, 1000),
        text: text.slice(0, 40000),
        truncated: text.length > 40000,
        snapshotId: snapshot.id,
        elementsTruncated: candidates.length > 100,
        elements: entries.map(({ element }, elementId) => ({
          elementId,
          tag: element.tagName.toLowerCase(),
          label: (
            element.getAttribute('aria-label') ||
            (element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement ||
            element instanceof HTMLSelectElement
              ? Array.from(element.labels ?? [])
                  .map((label) => label.innerText)
                  .join(' ') ||
                element.getAttribute('placeholder') ||
                ''
              : element.innerText)
          ).slice(0, 300),
          type: element.getAttribute('type') ?? '',
          ...(element instanceof HTMLAnchorElement ? { href: element.href.slice(0, 1000) } : {}),
        })),
      };
    }
    const snapshot = state.__saulPageSnapshot;
    const entry = snapshot?.entries[input.elementId ?? -1];
    if (
      !snapshot ||
      snapshot.id !== input.snapshotId ||
      snapshot.url !== location.href ||
      Date.now() - snapshot.at > 300000 ||
      !entry ||
      !entry.element.isConnected ||
      entry.fingerprint !== fingerprint(entry.element) ||
      !visible(entry.element)
    )
      throw new Error('Page reference is stale; read the page again');
    const element = entry.element;
    if (element.matches(':disabled, [aria-disabled="true"]'))
      throw new Error('Control is disabled');
    if (input.action === 'fill') {
      if (
        !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) ||
        element.readOnly ||
        (element instanceof HTMLInputElement &&
          !['text', 'search', 'email', 'url', 'tel', 'number'].includes(element.type))
      )
        throw new Error(
          'Fill requires an editable text field; password and file inputs are excluded',
        );
      if (input.value === undefined) throw new Error('Fill requires value');
    } else if (input.value !== undefined) throw new Error('Click does not accept value');
    const result = {
      dryRun: input.dryRun !== false,
      action: input.action,
      elementId: input.elementId!,
      url: location.href,
    };
    if (!result.dryRun) {
      // Consume before dispatch: failures may still have external effects.
      delete state.__saulPageSnapshot;
      if (input.action === 'click') element.click();
      else {
        const prototype =
          element instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, input.value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    return result;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function httpUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Only HTTP(S) URLs without embedded credentials are supported');
  return url.href;
}
export async function handlePageCall(name: string, input: unknown): Promise<PageResult> {
  const access = await chrome.storage.local.get(PAGE_ACCESS_KEY);
  if (access[PAGE_ACCESS_KEY] !== true)
    throw new Error('Enable Page reading and actions in Saul → Tabs first');
  const args = validateCall(name, input) as { tabId: number };
  const tab = await chrome.tabs.get(args.tabId);
  const window = await chrome.windows.get(tab.windowId);
  if (tab.incognito || window.incognito || window.type !== 'normal')
    throw new Error('Only non-incognito normal windows are supported');
  httpUrl(tab.url ?? '');
  if (tab.pendingUrl) throw new Error('Page is navigating; read again after it loads');
  if (name === 'saul_page_navigate') {
    const navigation = validateCall('saul_page_navigate', input);
    if (tab.url !== navigation.expectedUrl) throw new Error('Page URL changed; read again');
    const url = httpUrl(navigation.url);
    const dryRun = navigation.dryRun !== false;
    if (!dryRun) await chrome.tabs.update(args.tabId, { url });
    return { dryRun, tabId: args.tabId, url };
  }
  const action = name === 'saul_page_act' ? validateCall('saul_page_act', input) : undefined;
  const [injection] = await chrome.scripting.executeScript({
    target: {
      tabId: args.tabId,
      ...(action ? { documentIds: [action.documentId] } : { frameIds: [0] }),
    },
    world: 'ISOLATED',
    func: pageOperation,
    args: [action ?? {}],
  });
  if (!injection?.result) throw new Error('Page did not respond; read again before retrying');
  if ('error' in injection.result) throw new Error(injection.result.error);
  if (name === 'saul_page_read')
    return {
      ...injection.result,
      documentId: injection.documentId,
    } as ToolResults['saul_page_read'];
  return injection.result as ToolResults['saul_page_act'];
}
