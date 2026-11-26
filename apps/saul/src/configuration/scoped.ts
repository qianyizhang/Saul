import type { ScopedConfig } from '../../shared/protocol/shared-presets-contract.mts';
import type { Configuration } from './definition';
import { localProfile } from './connections';
import { decodeConfiguration } from './record';

// Connection secrets and the selected local account never enter the JSON file.
export function portableSettings(settings: Configuration): Record<string, unknown> {
  const value: Omit<Configuration, 'connections'> & { connections?: Configuration['connections'] } =
    structuredClone(settings);
  delete value.chatgptPlan;
  delete value.sharedCredentials;
  delete value.sharedPresetRevision;
  delete value.connections;
  delete value.scopedConfigRevision;
  value.openaiCompatible.apiKey = '';
  delete value.openaiCompatible.credentialOwner;
  for (const profile of value.profiles || []) {
    profile.config.apiKey = '';
    delete profile.config.credentialOwner;
  }
  if (value.configuration)
    value.configuration.presets = value.configuration.presets.filter(
      (p) => p.provider !== 'chatgpt-plan' && !p.shared,
    );
  return value as unknown as Record<string, unknown>;
}
export function restoreSettings(local: Configuration, config: ScopedConfig): Configuration {
  if (!config.value) return { ...local, scopedConfigRevision: config.revision };
  const value = decodeConfiguration({
    ...config.value,
    sharedPresetRevision: local.sharedPresetRevision,
    connections: local.connections,
    connectionProfiles: config.value.connectionProfiles ?? local.connectionProfiles,
  });
  const restoreCredential = (config: Configuration['openaiCompatible'], id: string) => {
    const current = localProfile(local, id)?.config;
    // A missing binding or changed endpoint never borrows another credential.
    config.apiKey = current?.baseUrl === config.baseUrl ? current.apiKey : '';
    config.credentialOwner =
      current?.baseUrl === config.baseUrl ? current.credentialOwner : undefined;
  };
  restoreCredential(value.openaiCompatible, value.activeProfileId || 'default');
  for (const profile of value.profiles ?? []) restoreCredential(profile.config, profile.id);
  value.chatgptPlan = local.chatgptPlan;
  value.sharedCredentials = local.sharedCredentials;
  value.configuration!.presets.push(
    ...(local.configuration?.presets || []).filter(
      (p) => p.provider === 'chatgpt-plan' || p.shared,
    ),
  );
  return { ...value, scopedConfigRevision: config.revision };
}
