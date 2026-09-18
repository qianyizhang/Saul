import { nanoid } from 'nanoid';
import type { DbMessage, HistoryItem } from '../types/storage';
import type { SelectionSnapshot, ResolvedContext, TagSegment } from '../types';

let creatingOffscreenPromise: Promise<void> | null = null;

export async function ensureOffscreenDocument(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.offscreen) {
    throw new Error('Offscreen storage requires Chrome with the offscreen API.');
  }

  if (creatingOffscreenPromise) return creatingOffscreenPromise;

  // Lock the existence check as well as creation: hasDocument() can become
  // true before the document's scripts have registered their message listener.
  creatingOffscreenPromise = (async () => {
    if (await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'] as any,
      justification: 'Saul SQLite local database operations',
    });
  })();
  try {
    await creatingOffscreenPromise;
  } finally {
    creatingOffscreenPromise = null;
  }
}

export async function sendDbMessage<T = any>(message: DbMessage): Promise<T> {
  // runtime.sendMessage does not deliver to its own sender. Background calls
  // must reach the offscreen document directly; popup calls go via background.
  const fromBackground = typeof document === 'undefined';
  if (fromBackground) await ensureOffscreenDocument();
  const request = fromBackground
    ? { ...message, target: 'saul-offscreen' }
    : { target: 'saul-background', message };
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(request, (response) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      if (!response) {
        return reject(new Error('No response received from SQLite offscreen worker.'));
      }
      if (!response.success) {
        return reject(new Error(response.error || 'Database operation failed.'));
      }
      resolve(response);
    });
  });
}

export async function recordExplanationRun(params: {
  snapshot: SelectionSnapshot;
  context: ResolvedContext;
  provider: string;
  model: string;
  promptVersion: string;
  systemPrompt: string;
  responseRaw: string;
  segments: TagSegment[];
  latencyMs?: number;
}): Promise<void> {
  const llmRunId = nanoid();

  const payload = {
    page: {
      url: params.snapshot.page.url,
      title: params.snapshot.page.title,
      canonicalUrl: params.snapshot.page.canonicalUrl,
    },
    selection: {
      id: params.snapshot.id,
      text: params.snapshot.text,
      prefix: params.snapshot.anchor.prefix,
      suffix: params.snapshot.anchor.suffix,
      domPath: params.snapshot.anchor.domPath,
      rectJson: JSON.stringify(params.snapshot.viewport),
      createdAt: params.snapshot.capturedAt || Date.now(),
    },
    llmRun: {
      id: llmRunId,
      widgetId: 'explain',
      provider: params.provider,
      model: params.model,
      promptVersion: params.promptVersion,
      promptRaw: params.systemPrompt,
      contextJson: JSON.stringify(params.context),
      responseRaw: params.responseRaw,
      responseStructured: JSON.stringify(params.segments),
      latencyMs: params.latencyMs,
      status: 'completed',
      createdAt: Date.now(),
    },
  };

  await sendDbMessage({
    type: 'DB_SAVE_RECORD',
    payload,
  });
}

export async function fetchHistory(
  limit = 50,
  offset = 0,
  searchQuery?: string,
  bookmarksOnly = false,
): Promise<HistoryItem[]> {
  const res = await sendDbMessage<{ success: boolean; history: HistoryItem[] }>({
    type: 'DB_GET_HISTORY',
    payload: { limit, offset, searchQuery, bookmarksOnly },
  });
  return res.history || [];
}

export async function deleteHistorySelection(selectionId: string): Promise<void> {
  await sendDbMessage({
    type: 'DB_DELETE_SELECTION',
    payload: { selectionId },
  });
}

export async function clearAllHistory(): Promise<void> {
  await sendDbMessage({
    type: 'DB_CLEAR_HISTORY',
  });
}

export async function exportKnowledgeMarkdown(): Promise<string> {
  const res = await sendDbMessage<{ success: boolean; markdown: string }>({
    type: 'DB_EXPORT_MARKDOWN',
  });
  return res.markdown || '';
}

export async function setHistoryBookmark(selectionId: string, bookmarked: boolean): Promise<void> {
  await sendDbMessage({ type: 'DB_SET_BOOKMARK', payload: { selectionId, bookmarked } });
}
