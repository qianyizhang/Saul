import {
  PLAN_HOST,
  validatePlanResult,
  type PlanControlRequest,
} from '../../native/plan-protocol.mts';
import {
  validateScopedConfigValue,
  type ScopedConfig,
} from '../../native/shared-presets-contract.mts';
import type { UserSettings } from '../types';
import { normalizeSettings } from './settings';

type Request = Extract<PlanControlRequest, { action: 'config-read' | 'config-save' }>;
export class ConfigUnavailableError extends Error {}
export async function scopedCall(request: Request): Promise<ScopedConfig> {
  if (request.action === 'config-save') validateScopedConfigValue(request.value);
  let reply;
  try {
    reply = await chrome.runtime.sendNativeMessage(PLAN_HOST, { id: crypto.randomUUID(), request });
  } catch (cause) {
    throw new ConfigUnavailableError('Unified config helper unavailable.', { cause });
  }
  if (reply?.event?.type === 'error') throw new Error(reply.event.message);
  validatePlanResult(request, reply?.event);
  return reply.event.config;
}

// Connection secrets and the selected local account never enter the JSON file.
export function portableSettings(settings: UserSettings): Record<string, unknown> {
  const value = structuredClone(settings);
  delete value.chatgptPlan;
  delete value.sharedPresetRevision;
  delete value.providers;
  delete value.scopedConfigRevision;
  value.openaiCompatible.apiKey = '';
  for (const profile of value.profiles || []) profile.config.apiKey = '';
  if (value.configuration)
    value.configuration.presets = value.configuration.presets.filter(
      (p) => p.provider !== 'chatgpt-plan' && !p.shared,
    );
  return value as unknown as Record<string, unknown>;
}
export function restoreSettings(local: UserSettings, config: ScopedConfig): UserSettings {
  if (!config.value) return { ...local, scopedConfigRevision: config.revision };
  const value = normalizeSettings({
    ...config.value,
    sharedPresetRevision: local.sharedPresetRevision,
    providers: local.providers,
    providerConnections: config.value.providerConnections ?? local.providerConnections,
  });
  const keyFor = (id: string | undefined, baseUrl: string) => {
    const connection = id
      ? local.profiles?.find((p) => p.id === id)?.config
      : local.openaiCompatible;
    // An edited endpoint cannot inherit credentials from another destination.
    return connection?.baseUrl === baseUrl ? connection.apiKey : '';
  };
  value.openaiCompatible.apiKey = keyFor(value.activeProfileId, value.openaiCompatible.baseUrl);
  for (const profile of value.profiles || [])
    profile.config.apiKey = keyFor(profile.id, profile.config.baseUrl);
  value.chatgptPlan = local.chatgptPlan;
  value.configuration!.presets.push(
    ...(local.configuration?.presets || []).filter(
      (p) => p.provider === 'chatgpt-plan' || p.shared,
    ),
  );
  return { ...value, scopedConfigRevision: config.revision };
}
