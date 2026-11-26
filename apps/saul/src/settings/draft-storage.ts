import {
  activeConnections,
  connectionDefinition,
  localProfile,
  type BoundConnection,
} from '../configuration/connections';
import { configurationFor, type Configuration } from '../configuration/definition';

type RetainedSettings = Pick<
  Configuration,
  | 'activeProvider'
  | 'activeProfileId'
  | 'openaiCompatible'
  | 'chromeAi'
  | 'sharedPresetRevision'
  | 'scopedConfigRevision'
>;

export type SettingsValues = Omit<
  Configuration,
  | keyof RetainedSettings
  | 'chatgptPlan'
  | 'connections'
  | 'connectionProfiles'
  | 'summaryPresetId'
  | 'summaryConnectionKey'
> & {
  connections: BoundConnection[];
  profiles: NonNullable<Configuration['profiles']>;
  configuration: NonNullable<Configuration['configuration']>;
  planAccountId?: string;
};

export interface SettingsDraft {
  values: SettingsValues;
  retained: Readonly<
    RetainedSettings & {
      planOptions?: Omit<NonNullable<Configuration['chatgptPlan']>, 'accountId'>;
      originalRoute?: Readonly<Configuration['openaiCompatible']>;
      /** Bindings whose connection is unavailable still round-trip in the saved document. */
      unlistedBindings?: Readonly<Record<string, string>>;
    }
  >;
  presetId: string;
  recipeId: string;
}

export function decodeDraftSettings(
  source: Configuration,
): Pick<SettingsDraft, 'values' | 'retained'> {
  const saved = structuredClone(source);
  // The Calls scope owns the current defaults. These are only legacy migration inputs.
  delete saved.summaryPresetId;
  delete saved.summaryConnectionKey;
  const {
    activeProvider,
    activeProfileId: savedProfileId,
    openaiCompatible,
    chromeAi,
    chatgptPlan,
    sharedPresetRevision,
    scopedConfigRevision,
    connections: definitions,
    connectionProfiles,
    ...values
  } = saved;
  const activeProfileId = savedProfileId || 'default';
  const connections = activeConnections({
    ...source,
    connections: definitions,
    connectionProfiles,
  });
  const profiles = values.profiles?.length
    ? values.profiles
    : [{ id: activeProfileId, name: 'Default', config: { ...openaiCompatible } }];
  return {
    values: {
      ...values,
      connections,
      profiles,
      configuration: structuredClone(configurationFor(source)),
      planAccountId: chatgptPlan?.accountId,
    },
    retained: {
      activeProvider,
      activeProfileId,
      openaiCompatible,
      chromeAi,
      sharedPresetRevision,
      scopedConfigRevision,
      ...(chatgptPlan
        ? {
            planOptions: {
              model: chatgptPlan.model,
              ...(chatgptPlan.effort === undefined ? {} : { effort: chatgptPlan.effort }),
              ...(chatgptPlan.fast === undefined ? {} : { fast: chatgptPlan.fast }),
            },
          }
        : {}),
      originalRoute: profiles.find((p) => p.id === activeProfileId)?.config,
      ...(connectionProfiles
        ? {
            unlistedBindings: Object.fromEntries(
              Object.entries(connectionProfiles).filter(
                ([key]) => !definitions.some((connection) => connection.key === key),
              ),
            ),
          }
        : {}),
    },
  };
}

export function encodeDraftConnections(
  definitions: BoundConnection[],
  unlisted: SettingsDraft['retained']['unlistedBindings'],
) {
  const bindings: Record<string, string> = { ...unlisted };
  const connections = definitions.map((connection) => {
    if (connection.localProfileId !== undefined)
      bindings[connection.key] = connection.localProfileId;
    return connectionDefinition(connection);
  });
  return {
    connections,
    ...(unlisted !== undefined || Object.keys(bindings).length
      ? { connectionProfiles: bindings }
      : {}),
  };
}

export type DraftInspectionSettings = Omit<Configuration, 'connections' | 'connectionProfiles'> & {
  connections: BoundConnection[];
};

/** Active inspection uses the draft's joined rows. Legacy mirroring runs only on encoding. */
export function draftInspectionSettings(draft: SettingsDraft): DraftInspectionSettings {
  const { planAccountId, ...values } = draft.values;
  const {
    activeProvider,
    activeProfileId,
    openaiCompatible,
    chromeAi,
    sharedPresetRevision,
    scopedConfigRevision,
    planOptions,
  } = draft.retained;
  return {
    ...values,
    activeProvider,
    activeProfileId,
    openaiCompatible,
    chromeAi,
    sharedPresetRevision,
    scopedConfigRevision,
    ...(planOptions || planAccountId !== undefined
      ? {
          chatgptPlan: {
            ...planOptions,
            model: planOptions?.model ?? '',
            accountId: planAccountId ?? '',
          },
        }
      : {}),
  };
}

/** Encode the active draft for existing Chrome and shared configuration readers. */
export function settingsFromDraft(draft: SettingsDraft): Configuration {
  const settings = draftInspectionSettings(draft);
  const { originalRoute, unlistedBindings } = draft.retained;
  const active = localProfile(settings, settings.activeProfileId)?.config;
  const changedRoute =
    active &&
    originalRoute &&
    (active.baseUrl !== originalRoute.baseUrl ||
      active.apiKey !== originalRoute.apiKey ||
      active.credentialOwner !== originalRoute.credentialOwner);
  return {
    ...settings,
    ...encodeDraftConnections(draft.values.connections, unlistedBindings),
    openaiCompatible: changedRoute
      ? {
          ...settings.openaiCompatible,
          baseUrl: active.baseUrl,
          apiKey: active.apiKey,
          credentialOwner: active.credentialOwner,
        }
      : settings.openaiCompatible,
  };
}
