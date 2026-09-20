export interface SelectionSnapshot {
  id: string;
  text: string;
  page: {
    url: string;
    canonicalUrl?: string;
    title: string;
    favicon?: string;
  };
  anchor: {
    exact: string;
    prefix: string;
    suffix: string;
    textStart?: number;
    textEnd?: number;
    domPath?: string;
  };
  viewport: {
    x: number;
    y: number;
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
  };
  capturedAt: number;
}

export interface ContextPolicy {
  includeSelection: boolean;
  surroundingCharacters?: {
    before: number;
    after: number;
  };
  includeContainingParagraph: boolean;
  includeContainingHeading: boolean;
  includePageMetadata: boolean;
}

export interface ResolvedContext {
  selection: string;
  surroundingText?: string;
  paragraph?: string;
  heading?: string;
  pageTitle: string;
  pageUrl: string;
}

export type TagSegment =
  | {
      id: string;
      type: 'text';
      text: string;
    }
  | {
      id: string;
      type: 'term';
      term: string;
      note: string;
      complete: boolean;
    };

export interface WidgetDefinition {
  id: string;
  label: string;
  icon?: string;
  description: string;
  promptTemplate: string;
  contextPolicy: ContextPolicy;
}

export type ProviderType = 'openai-compatible' | 'chrome-ai';

export interface ModelConfig {
  id: string;
  name: string;
  provider: ProviderType;
  baseUrl?: string;
  apiKey?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ProviderProfile {
  id: string;
  name: string;
  config: UserSettings['openaiCompatible'];
}

export interface UserSettings {
  profiles?: ProviderProfile[];
  activeProfileId?: string;
  responseLanguage?: string;
  activeProvider: ProviderType;
  openaiCompatible: {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
  };
  chromeAi: {
    temperature: number;
    topK: number;
  };
  contextPolicy: ContextPolicy;
  customPromptTemplate?: string;
}
