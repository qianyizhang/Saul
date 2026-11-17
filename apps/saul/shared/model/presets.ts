import type {
  ActionCapability,
  SharedImageOptions,
  SharedSpeechOptions,
} from '../protocol/shared-presets-contract.mts';
export type ProviderType = 'openai-compatible' | 'chrome-ai' | 'chatgpt-plan';

export interface ModelPreset {
  id: string;
  name: string;
  provider: ProviderType;
  model: string;
  profileId?: string;
  temperature?: number;
  topK?: number;
  effort?: string;
  fast?: boolean;
  connectionKey?: string;
  capability?: ActionCapability;
  imageOptions?: SharedImageOptions;
  speechOptions?: SharedSpeechOptions;
  shared?: boolean;
}

export interface Recipe {
  capability?: 'write' | 'draw';
  id: string;
  name: string;
  presetId: string;
  template: string;
  systemPrompt: string;
}
