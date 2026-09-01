export interface PageRecord {
  id: string;
  url: string;
  canonicalUrl?: string;
  title: string;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface SelectionRecord {
  id: string;
  pageId: string;
  text: string;
  prefix?: string;
  suffix?: string;
  textStart?: number;
  textEnd?: number;
  domPath?: string;
  rectJson?: string;
  createdAt: number;
}

export interface LLMRunRecord {
  id: string;
  selectionId: string;
  widgetId: string;
  provider: string;
  model: string;
  promptVersion: string;
  promptRaw: string;
  contextJson: string;
  responseRaw: string;
  responseStructured?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  status: 'running' | 'completed' | 'failed' | 'aborted';
  errorMessage?: string;
  createdAt: number;
}

export interface InteractionRecord {
  id: string;
  selectionId?: string;
  llmRunId?: string;
  eventType: string;
  eventData?: string;
  createdAt: number;
}

export interface HistoryItem {
  selectionId: string;
  selectedText: string;
  pageTitle: string;
  pageUrl: string;
  responseRaw: string;
  model: string;
  provider: string;
  latencyMs?: number;
  createdAt: number;
}

export type DbMessage =
  | {
      type: 'DB_SAVE_RECORD';
      payload: {
        page: { url: string; title: string; canonicalUrl?: string };
        selection: {
          id: string;
          text: string;
          prefix?: string;
          suffix?: string;
          domPath?: string;
          rectJson?: string;
          createdAt: number;
        };
        llmRun: {
          id: string;
          widgetId: string;
          provider: string;
          model: string;
          promptVersion: string;
          promptRaw: string;
          contextJson: string;
          responseRaw: string;
          responseStructured?: string;
          latencyMs?: number;
          status: string;
          createdAt: number;
        };
      };
    }
  | {
      type: 'DB_GET_HISTORY';
      payload: {
        limit?: number;
        offset?: number;
        searchQuery?: string;
      };
    }
  | {
      type: 'DB_DELETE_SELECTION';
      payload: {
        selectionId: string;
      };
    }
  | {
      type: 'DB_CLEAR_HISTORY';
    }
  | {
      type: 'DB_EXPORT_MARKDOWN';
    };
