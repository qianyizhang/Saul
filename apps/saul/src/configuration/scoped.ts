import type { ScopedConfig } from '../../shared/protocol/shared-presets-contract.mts';
import type { Configuration } from './definition';
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
  const keyFor = (id: string | undefined, baseUrl: string) => {
    const connection = id
      ? local.profiles?.find((p) => p.id === id)?.config
      : local.openaiCompatible;
    // An edited endpoint cannot inherit credentials from another destination.
    return connection?.baseUrl === baseUrl ? connection.apiKey : '';
  };
  value.openaiCompatible.apiKey = keyFor(value.activeProfileId, value.openaiCompatible.baseUrl);
  const ownerFor = (id: string | undefined, endpoint: string) => {
    const connection = id
      ? local.profiles?.find((p) => p.id === id)?.config
      : local.openaiCompatible;
    return connection?.baseUrl === endpoint ? connection.credentialOwner : undefined;
  };
  value.openaiCompatible.credentialOwner = ownerFor(
    value.activeProfileId,
    value.openaiCompatible.baseUrl,
  );
  for (const profile of value.profiles || []) {
    profile.config.apiKey = keyFor(profile.id, profile.config.baseUrl);
    profile.config.credentialOwner = ownerFor(profile.id, profile.config.baseUrl);
  }
  value.chatgptPlan = local.chatgptPlan;
  value.sharedCredentials = local.sharedCredentials;
  value.configuration!.presets.push(
    ...(local.configuration?.presets || []).filter(
      (p) => p.provider === 'chatgpt-plan' || p.shared,
    ),
  );
  return { ...value, scopedConfigRevision: config.revision };
}
