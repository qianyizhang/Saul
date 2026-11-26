import type { ModelPreset } from '../../shared/model/presets.ts';
import type { ConnectionDefinition } from '../../shared/protocol/shared-presets-contract.mts';
import type { APIProfile, Configuration } from './definition';

export type BoundConnection = ConnectionDefinition & { localProfileId?: string };

export function connectionDefinition({
  key,
  name,
  kind,
  accountId,
  baseUrl,
}: ConnectionDefinition): ConnectionDefinition {
  return {
    key,
    name,
    kind,
    ...(accountId === undefined ? {} : { accountId }),
    ...(baseUrl === undefined ? {} : { baseUrl }),
  };
}

type ConnectionSettings = Pick<
  Configuration,
  'connectionProfiles' | 'profiles' | 'activeProfileId' | 'openaiCompatible'
> & { connections: readonly BoundConnection[] };

/** Read only. These rows join a saved connection with its local credential reference. */
export function activeConnections(settings: ConnectionSettings): BoundConnection[] {
  const { connectionProfiles } = settings;
  return settings.connections.map((connection) => {
    const legacy =
      connectionProfiles && Object.hasOwn(connectionProfiles, connection.key)
        ? connectionProfiles[connection.key]
        : undefined;
    const localProfileId = connection.localProfileId ?? legacy;
    return {
      ...connection,
      ...(localProfileId === undefined ? {} : { localProfileId }),
    };
  });
}

export function localProfile(
  settings: Pick<Configuration, 'profiles' | 'activeProfileId' | 'openaiCompatible'>,
  id: string | undefined,
): APIProfile | undefined {
  if (id === undefined) return;
  if (settings.profiles) return settings.profiles.find((profile) => profile.id === id);
  return id === (settings.activeProfileId || 'default')
    ? { id, name: 'Default', config: settings.openaiCompatible }
    : undefined;
}

export function activePresetBinding(
  settings: ConnectionSettings,
  preset: ModelPreset,
  frozenProfileId?: string,
) {
  const connection = activeConnections(settings).find((item) => item.key === preset.connectionKey);
  const profileId = frozenProfileId ?? connection?.localProfileId ?? preset.profileId;
  return {
    connection,
    profileId,
    localProfile: localProfile(settings, profileId),
  };
}

export function selectLocalProfile(
  settings: Pick<Configuration, 'profiles' | 'activeProfileId' | 'openaiCompatible'>,
  connection: BoundConnection,
): string | undefined {
  if (connection.kind !== 'openai-api') return;
  const active = localProfile(settings, settings.activeProfileId || 'default');
  const official = 'https://api.openai.com/v1';
  const canAdopt =
    (connection.baseUrl ?? official) === official &&
    active?.config.baseUrl.replace(/\/+$/, '') === official;
  return connection.localProfileId ?? (canAdopt ? active.id : undefined);
}
