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

export type ProviderType = 'openai-compatible' | 'chrome-ai' | 'chatgpt-plan';

export interface ProviderProfile {
  id: string;
  name: string;
  config: UserSettings['openaiCompatible'];
}

export interface ModelPreset {
  id: string;
  name: string;
  provider: ProviderType;
  model: string;
  profileId?: string;
  accountId?: string;
  temperature?: number;
  topK?: number;
  effort?: string;
  fast?: boolean;
}

export interface Recipe {
  id: string;
  name: string;
  presetId: string;
  template: string;
  systemPrompt: string;
}

export interface ReadingConfiguration {
  schemaVersion: 1;
  selectedRecipeId: string;
  presets: ModelPreset[];
  recipes: Recipe[];
}

export interface UserSettings {
  summaryPdfProcessing?: 'attachment' | 'local';
  sharedPresetRevision?: number;
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
  chatgptPlan?: { accountId: string; model: string; effort?: string; fast?: boolean };
  chromeAi: {
    temperature: number;
    topK: number;
  };
  contextPolicy: ContextPolicy;
  customPromptTemplate?: string;
  configuration?: ReadingConfiguration;
}
