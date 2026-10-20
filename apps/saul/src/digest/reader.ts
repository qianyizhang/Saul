import type { SummaryProgress } from '../../native/protocol.mjs';
import type { DigestBatch } from './types';
import { runnerRequest } from '../storage/client';
import { id as validId } from '../contracts/reading';

export async function openSummaryReader(args: { tabIds?: number[]; id?: string }) {
  if (Boolean(args.id) === Boolean(args.tabIds?.length))
    throw new Error('Choose a selection or a saved summary.');
  if (args.id && !validId(args.id)) throw new Error('Invalid summary ID.');
  if (args.id)
    await runnerRequest({ operation: 'digest', message: { action: 'get', id: args.id } });
  if (args.tabIds) {
    const tabs = await Promise.all(args.tabIds.map((id) => chrome.tabs.get(id)));
    for (const windowId of new Set(tabs.map((t) => t.windowId))) {
      const window = await chrome.windows.get(windowId);
      if (window.incognito || window.type !== 'normal')
        throw new Error('Choose tabs in regular browser windows.');
    }
  }
  const id = args.id || crypto.randomUUID();
  const query = args.tabIds ? '?tabs=' + args.tabIds.join(',') : '';
  await chrome.tabs.create({
    url: chrome.runtime.getURL('/library.html#summary/' + encodeURIComponent(id) + query),
  });
  return { id };
}

export async function summaryProgress(): Promise<SummaryProgress | null> {
  const batch = await runnerRequest<DigestBatch | undefined>({
    operation: 'digest',
    message: { action: 'active' },
  });
  return batch
    ? {
        id: batch.id,
        completed: batch.items.filter((i) => i.status === 'completed').length,
        total: batch.items.length,
      }
    : null;
}
