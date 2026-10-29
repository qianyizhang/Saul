import { getWindowLabels } from '../native/window-labels';
import { SUMMARY_PROMPT } from './summary';
import type { DigestBatch, DigestItem, DigestCapture, PdfProcessing } from './types';

export async function snapshotSelection(
  id: string,
  tabIds: number[],
  accountId: string,
  pdfProcessing: PdfProcessing = 'attachment',
): Promise<DigestBatch> {
  const tabs = await Promise.all(tabIds.map((id) => chrome.tabs.get(id)));
  const windowIds = [...new Set(tabs.map((t) => t.windowId))];
  for (const windowId of windowIds) {
    const window = await chrome.windows.get(windowId);
    if (window.incognito || window.type !== 'normal')
      throw new Error('Choose tabs in regular browser windows.');
  }
  if (!tabs.length) throw new Error('Select tabs to summarize.');
  const labels = await getWindowLabels();
  const windows = (await chrome.windows.getAll({ windowTypes: ['normal'] })).filter(
    (w) => !w.incognito,
  );
  const windowName = (id: number) =>
    labels[id] || 'Window ' + (windows.findIndex((w) => w.id === id) + 1);
  return {
    id,
    windowId: windowIds[0]!,
    accountId,
    pdfProcessing,
    windowTitle:
      windowIds.length === 1 ? windowName(windowIds[0]!) : tabs.length + ' selected tabs',
    createdAt: Date.now(),
    model: 'gpt-6-luna',
    effort: 'medium',
    prompt: SUMMARY_PROMPT,
    items: tabs.map((tab, index) => ({
      index,
      tabId: tab.id!,
      windowId: tab.windowId,
      windowTitle: windowName(tab.windowId),
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
export function extractPage(expectedUrl: string): DigestCapture {
  if (location.href !== expectedUrl)
    throw new Error('The tab navigated. Start a new summary for its current page.');
  // Chrome's top-level PDF wrapper exposes an embed, not the document text.
  // Do not follow PDFs embedded alongside an ordinary article.
  if (
    document.contentType === 'application/pdf' ||
    (document.querySelector('embed[type="application/pdf"], object[type="application/pdf"]') &&
      (document.body?.innerText.trim().length || 0) < 100)
  )
    return { pdf: { url: expectedUrl, title: document.title } };
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
    throw new Error('Not enough readable text. Load the page and try a new summary.');
  const truncated = text.length > 120000;
  return {
    title: document.title,
    text: text.slice(0, 120000),
    capturedAt: Date.now(),
    truncated,
    coverage: `Visible ${root === document.body ? 'page' : 'article'} text and loaded discussion only; no video or audio content, linked pages, images, collapsed or unloaded content.${truncated ? ' Limited to the first 120,000 characters.' : ''}`,
  };
}
export async function verifyCaptureTab(item: DigestItem): Promise<void> {
  const tab = await chrome.tabs.get(item.tabId);
  if (tab.incognito || tab.url !== item.url || !/^https?:\/\//.test(item.url))
    throw new Error('Source tab changed or is unavailable. Start a new summary.');
  if (tab.discarded || tab.status !== 'complete')
    throw new Error('Tab is unloaded or still loading. Load it, then retry.');
}
export async function captureTab(item: DigestItem): Promise<DigestCapture> {
  await verifyCaptureTab(item);
  const pdf = { pdf: { url: item.url, title: item.title } };
  if (/\.pdf$/i.test(new URL(item.url).pathname)) return pdf;
  let result: DigestCapture | undefined;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: item.tabId },
      func: extractPage,
      args: [item.url],
    });
    result = results[0]?.result;
  } catch {
    // Some Chrome versions deny injection into the PDF wrapper. A bounded
    // download may identify an extensionless PDF; HTML is never used as fallback.
    result = { pdf: { ...pdf.pdf, unverified: true } };
  }
  await verifyCaptureTab(item);
  if (!result) throw new Error('Page text could not be read.');
  return result;
}
