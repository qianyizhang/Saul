import { getWindowLabels } from '../native/window-labels';
import { SUMMARY_PROMPT } from './summary';
import type { DigestBatch, DigestItem, DigestSource } from './types';

export async function snapshotWindow(
  id: string,
  windowId: number,
  accountId: string,
): Promise<DigestBatch> {
  const window = await chrome.windows.get(windowId);
  if (window.incognito || window.type !== 'normal')
    throw new Error('Choose a regular browser window.');
  const tabs = (await chrome.tabs.query({ windowId })).sort((a, b) => a.index - b.index);
  if (!tabs.length) throw new Error('This window has no tabs.');
  return {
    id,
    windowId,
    accountId,
    windowTitle: (await getWindowLabels())[windowId] || `Window ${windowId}`,
    createdAt: Date.now(),
    model: 'gpt-6-luna',
    effort: 'medium',
    prompt: SUMMARY_PROMPT,
    items: tabs.map((tab, index) => ({
      index,
      tabId: tab.id!,
      title: tab.title || 'Untitled tab',
      url: tab.url || '',
      raw: '',
      status: !tab.incognito && /^https?:\/\//.test(tab.url || '') ? 'queued' : 'skipped',
      ...(!/^https?:\/\//.test(tab.url || '') || tab.incognito
        ? { error: 'Only regular HTTP(S) pages can be summarized.' }
        : {}),
    })),
  };
}
// Runs in the isolated page world. It must be self-contained for executeScript.
export function extractPage(expectedUrl: string): DigestSource {
  if (location.href !== expectedUrl)
    throw new Error('The tab navigated. Start a new digest for its current page.');
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      'article, main, [role="main"], .entry-content, .post-content',
    ),
  );
  const main = candidates.sort((a, b) => b.innerText.length - a.innerText.length)[0];
  const root = main && main.innerText.trim().length > 200 ? main : document.body;
  let text = root?.innerText || '';
  const comments = Array.from(document.querySelectorAll<HTMLElement>('#comments, .commentlist'));
  for (const el of comments)
    if (!root?.contains(el) && !comments.some((other) => other !== el && other.contains(el)))
      text += '\n\nDiscussion:\n' + el.innerText;
  if (text.trim().length < 100)
    throw new Error('Not enough readable text. Load the page and try a new digest.');
  const truncated = text.length > 120000;
  return {
    text: text.slice(0, 120000),
    capturedAt: Date.now(),
    truncated,
    coverage: `Visible ${root === document.body ? 'page' : 'article'} text and loaded discussion only; no linked pages, images, collapsed or unloaded content.${truncated ? ' Limited to the first 120,000 characters.' : ''}`,
  };
}
export async function captureTab(item: DigestItem): Promise<DigestSource> {
  const tab = await chrome.tabs.get(item.tabId);
  if (tab.incognito || tab.url !== item.url || !/^https?:\/\//.test(item.url))
    throw new Error('Source tab changed or is unavailable. Start a new digest.');
  if (tab.discarded || tab.status !== 'complete')
    throw new Error('Tab is unloaded or still loading. Load it, then retry.');
  const results = await chrome.scripting.executeScript({
    target: { tabId: item.tabId },
    func: extractPage,
    args: [item.url],
  });
  const result = results[0]?.result;
  if ((await chrome.tabs.get(item.tabId)).url !== item.url)
    throw new Error('Tab navigated while capturing. Start a new digest.');
  if (!result?.text) throw new Error('Page text could not be read.');
  return result;
}
