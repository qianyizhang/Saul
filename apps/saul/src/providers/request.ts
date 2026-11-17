import type { ModelPreset, ProviderType } from '../configuration/definition';

/** Persistable model choices; no page context, database fields or credential bytes. */
export interface FrozenModel {
  provider: ProviderType;
  credentialOwner?: 'local' | 'saul';
  remote: { baseUrl: string; model: string; temperature: number; credentialOwner?: 'saul' };
  local: { temperature: number; topK: number };
  plan?: { accountId: string; model: string; effort?: string; fast?: boolean };
  preset?: ModelPreset;
}
export interface ModelRequest extends FrozenModel {
  systemPrompt: string;
  userPrompt: string;
}
