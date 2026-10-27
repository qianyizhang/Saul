import { validateCall } from '../../native/protocol.mts';
import { id as validId } from '../contracts/reading';

export const summaryPanelKey = (windowId: number) => `saul-summary-panel-${windowId}`;

export async function closeSummaryPanel(windowId: number): Promise<void> {
  if (!Number.isSafeInteger(windowId) || windowId < 0)
    throw new Error('The browser window is unavailable.');
  const panel = chrome.sidePanel as typeof chrome.sidePanel & {
    close(options: { windowId: number }): Promise<void>;
  };
  if (typeof panel.close !== 'function')
    throw new Error(
      'Closing the summary panel requires Chrome 141 or later. Use Chrome’s panel close button.',
    );
  return panel.close({ windowId });
}

export function summaryPanelRoute(value: unknown): string {
  if (value === '#summaries') return value;
  if (typeof value !== 'string' || !value.startsWith('#summary/')) return '#summaries';
  try {
    const [path, query] = value.split('?');
    const id = decodeURIComponent(path!.slice('#summary/'.length));
    if (!validId(id)) return '#summaries';
    const tabs = new URLSearchParams(query).get('tabs');
    if (tabs === '') return '#summaries';
    validateCall('saul_summary_open', tabs ? { tabIds: tabs.split(',').map(Number) } : { id });
    return value;
  } catch {
    return '#summaries';
  }
}

// Invoke directly in the browser gesture, before awaiting any other API.
export async function openSummaryPanel(windowId: number, args: { tabIds?: number[]; id?: string }) {
  validateCall('saul_summary_open', args);
  if (!Number.isSafeInteger(windowId) || windowId < 0)
    throw new Error('The browser window is unavailable.');
  if (Boolean(args.id) === Boolean(args.tabIds?.length))
    throw new Error('Choose a selection or a saved summary.');
  const id = args.id || crypto.randomUUID();
  const route =
    '#summary/' + encodeURIComponent(id) + (args.tabIds ? '?tabs=' + args.tabIds.join(',') : '');
  // Both requests are dispatched while the gesture is live. A popup can close
  // as the panel opens; routing must not depend on its later promise callbacks.
  const routeWritten = chrome.storage.session.set({ [summaryPanelKey(windowId)]: route });
  const opened = chrome.sidePanel.open({ windowId });
  return Promise.all([routeWritten, opened]).then(() => ({ id }));
}
