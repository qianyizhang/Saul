import { nanoid } from 'nanoid';
import type { DbMessage, HistoryItem } from '../types/storage';
import type { SelectionSnapshot, ResolvedContext, TagSegment } from '../types';

let creatingOffscreenPromise: Promise<void> | null = null;

export async function ensureOffscreenDocument(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.offscreen) {
    return;
  }

  // Check if offscreen document already exists
  try {
    if (typeof chrome.offscreen.hasDocument === 'function') {
      const hasDoc = await chrome.offscreen.hasDocument();
      if (hasDoc) return;
    }
  } catch {
    // hasDocument may not be available in older Chrome
  }

  if (creatingOffscreenPromise) {
    return creatingOffscreenPromise;
  }

  creatingOffscreenPromise = (async () => {
    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['WORKERS', 'LOCAL_STORAGE'] as any,
        justification: 'Saul SQLite local database operations',
      });
      console.log('[Saul] Offscreen document created');
    } catch (err: any) {
      // If already exists, ignore
      if (!err.message?.includes('Only a single offscreen document may be created')) {
        console.error('[Saul] Failed to create offscreen document:', err);
      }
    } finally {
      creatingOffscreenPromise = null;
    }
  })();

  return creatingOffscreenPromise;
}

export async function sendDbMessage<T = any>(message: DbMessage): Promise<T> {
  await ensureOffscreenDocument();

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
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
  searchQuery?: string
): Promise<HistoryItem[]> {
  const res = await sendDbMessage<{ success: boolean; history: HistoryItem[] }>({
    type: 'DB_GET_HISTORY',
    payload: { limit, offset, searchQuery },
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
