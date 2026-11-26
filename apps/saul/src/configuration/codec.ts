import { validateConnections } from '../../shared/protocol/shared-presets-contract.mts';
import type { Configuration } from './definition';
import { normalizeConfiguration, DEFAULT_CONFIGURATION } from './definition';

export class InvalidStoredSettingsError extends Error {
  constructor(detail: string, options?: ErrorOptions) {
    super(
      `Saved settings need repair. ${detail} They can be backed up and reset from Saul Settings.`,
      options,
    );
    this.name = 'InvalidStoredSettingsError';
  }
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown, field: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`Saved ${field} must be an object.`);
  return value as JsonRecord;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`Saved ${field} must be text.`);
  return value;
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`Saved ${field} must be a finite number.`);
  return value;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`Saved ${field} must be true or false.`);
  return value;
}

function normalizeRemoteConfig(
  value: unknown,
  fallback = DEFAULT_CONFIGURATION.openaiCompatible,
): Configuration['openaiCompatible'] {
  if (value === undefined) return { ...fallback };
  const stored = record(value, 'OpenAI-compatible settings');
  if (stored.credentialOwner !== undefined && stored.credentialOwner !== 'saul')
    throw new Error('Saved API credential owner is not supported.');
  return {
    baseUrl: optionalString(stored.baseUrl, 'model endpoint') ?? fallback.baseUrl,
    apiKey: optionalString(stored.apiKey, 'API key') ?? fallback.apiKey,
    ...(stored.credentialOwner === 'saul' ? { credentialOwner: 'saul' as const } : {}),
    model: optionalString(stored.model, 'model name') ?? fallback.model,
    temperature: optionalNumber(stored.temperature, 'provider temperature') ?? fallback.temperature,
  };
}

export function decodeConfiguration(value: unknown): Configuration {
  const stored = record(value, 'settings');
  if (['providers', 'providerConnections', 'summaryProviderKey'].some((key) => key in stored))
    throw new Error('Obsolete configuration fields are not supported.');
  if (
    stored.sharedCredentials !== undefined &&
    stored.sharedCredentials !== 'saul' &&
    stored.sharedCredentials !== 'disconnected'
  )
    throw new Error('Saved credential connection is not supported.');
  const activeProvider = stored.activeProvider ?? DEFAULT_CONFIGURATION.activeProvider;
  if (
    activeProvider !== 'openai-compatible' &&
    activeProvider !== 'chrome-ai' &&
    activeProvider !== 'chatgpt-plan'
  )
    throw new Error('Saved provider is not supported.');

  const chromeAi =
    stored.chromeAi === undefined ? {} : record(stored.chromeAi, 'Chrome AI settings');
  const contextPolicy =
    stored.contextPolicy === undefined ? {} : record(stored.contextPolicy, 'context policy');
  const surrounding =
    contextPolicy.surroundingCharacters === undefined
      ? undefined
      : record(contextPolicy.surroundingCharacters, 'surrounding-character settings');
  const openaiCompatible = normalizeRemoteConfig(stored.openaiCompatible);
  const profiles =
    stored.profiles === undefined
      ? undefined
      : (() => {
          if (!Array.isArray(stored.profiles))
            throw new Error('Saved API profiles must be a list.');
          const ids = new Set<string>();
          return stored.profiles.map((value, index) => {
            const profile = record(value, `API profile ${index + 1}`);
            const id = optionalString(profile.id, 'profile ID');
            const name = optionalString(profile.name, 'profile name');
            if (!id || name === undefined)
              throw new Error('Saved API profiles require an ID and name.');
            if (ids.has(id)) throw new Error('Saved API profile IDs must be unique.');
            ids.add(id);
            return { id, name, config: normalizeRemoteConfig(profile.config) };
          });
        })();
  const activeProfileId = optionalString(stored.activeProfileId, 'active profile ID');
  const responseLanguage = optionalString(stored.responseLanguage, 'response language');
  const customPromptTemplate = optionalString(stored.customPromptTemplate, 'custom prompt');
  const summaryPdfProcessing =
    stored.summaryPdfProcessing === undefined
      ? DEFAULT_CONFIGURATION.summaryPdfProcessing
      : stored.summaryPdfProcessing;
  if (summaryPdfProcessing !== 'attachment' && summaryPdfProcessing !== 'local')
    throw new Error('Saved PDF processing must be attachment or local.');

  if (stored.connections !== undefined) validateConnections(stored.connections);
  const summaryPresetId = optionalString(stored.summaryPresetId, 'summary model preset');
  if (summaryPresetId !== undefined && (!summaryPresetId.trim() || summaryPresetId.length > 128))
    throw new Error('Invalid saved summary model preset.');
  const summaryConnectionKey = optionalString(stored.summaryConnectionKey, 'summary connection');
  if (summaryConnectionKey !== undefined && !/^[a-z][a-z0-9-]{0,63}$/.test(summaryConnectionKey))
    throw new Error('Invalid saved summary connection key.');
  let connectionProfiles: Record<string, string> | undefined;
  if (stored.connectionProfiles !== undefined) {
    const bindings = record(stored.connectionProfiles, 'Connection profiles');
    if (
      Object.entries(bindings).some(
        ([key, id]) =>
          !/^[a-z][a-z0-9-]{0,63}$/.test(key) || typeof id !== 'string' || !id || id.length > 128,
      )
    )
      throw new Error('Invalid local connection profile.');
    connectionProfiles = bindings as Record<string, string>;
  }
  const settings: Configuration = {
    ...DEFAULT_CONFIGURATION,
    ...(stored.sharedCredentials === undefined
      ? {}
      : { sharedCredentials: stored.sharedCredentials as 'saul' | 'disconnected' }),
    connections: structuredClone(
      stored.connections === undefined ? DEFAULT_CONFIGURATION.connections : stored.connections,
    ),
    ...(connectionProfiles === undefined ? {} : { connectionProfiles }),
    summaryPdfProcessing,
    ...(summaryPresetId === undefined ? {} : { summaryPresetId }),
    ...(summaryConnectionKey === undefined ? {} : { summaryConnectionKey }),
    scopedConfigRevision: optionalNumber(stored.scopedConfigRevision, 'scoped config revision'),
    ...(stored.sharedPresetRevision === undefined
      ? {}
      : {
          sharedPresetRevision: optionalNumber(
            stored.sharedPresetRevision,
            'shared preset revision',
          ),
        }),
    activeProvider,
    openaiCompatible,
    ...(stored.chatgptPlan === undefined
      ? {}
      : {
          chatgptPlan: {
            accountId:
              optionalString(
                record(stored.chatgptPlan, 'ChatGPT plan').accountId,
                'ChatGPT account',
              ) ?? '',
            model:
              optionalString(record(stored.chatgptPlan, 'ChatGPT plan').model, 'ChatGPT model') ??
              '',
            ...(record(stored.chatgptPlan, 'ChatGPT plan').effort === undefined
              ? {}
              : {
                  effort: optionalString(
                    record(stored.chatgptPlan, 'ChatGPT plan').effort,
                    'ChatGPT effort',
                  ),
                }),
            ...(record(stored.chatgptPlan, 'ChatGPT plan').fast === undefined
              ? {}
              : {
                  fast: optionalBoolean(
                    record(stored.chatgptPlan, 'ChatGPT plan').fast,
                    'ChatGPT Fast',
                  ),
                }),
          },
        }),
    chromeAi: {
      temperature:
        optionalNumber(chromeAi.temperature, 'Chrome AI temperature') ??
        DEFAULT_CONFIGURATION.chromeAi.temperature,
      topK: optionalNumber(chromeAi.topK, 'Chrome AI top K') ?? DEFAULT_CONFIGURATION.chromeAi.topK,
    },
    contextPolicy: {
      includeSelection:
        optionalBoolean(contextPolicy.includeSelection, 'include-selection setting') ??
        DEFAULT_CONFIGURATION.contextPolicy.includeSelection,
      ...(surrounding
        ? {
            surroundingCharacters: {
              before: optionalNumber(surrounding.before, 'characters before selection') ?? 0,
              after: optionalNumber(surrounding.after, 'characters after selection') ?? 0,
            },
          }
        : {}),
      includeContainingParagraph:
        optionalBoolean(contextPolicy.includeContainingParagraph, 'paragraph-context setting') ??
        DEFAULT_CONFIGURATION.contextPolicy.includeContainingParagraph,
      includeContainingHeading:
        optionalBoolean(contextPolicy.includeContainingHeading, 'heading-context setting') ??
        DEFAULT_CONFIGURATION.contextPolicy.includeContainingHeading,
      includePageMetadata:
        optionalBoolean(contextPolicy.includePageMetadata, 'page-metadata setting') ??
        DEFAULT_CONFIGURATION.contextPolicy.includePageMetadata,
    },
    ...(profiles ? { profiles } : {}),
    ...(activeProfileId === undefined ? {} : { activeProfileId }),
    ...(responseLanguage === undefined ? {} : { responseLanguage }),
    ...(customPromptTemplate === undefined ? {} : { customPromptTemplate }),
  };
  settings.configuration = normalizeConfiguration(stored.configuration, settings);
  return settings;
}

export function settingsFromStored(stored: unknown): Configuration {
  if (stored === undefined) return structuredClone(DEFAULT_CONFIGURATION);
  try {
    return decodeConfiguration(stored);
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Their format is not supported.';
    throw new InvalidStoredSettingsError(detail, { cause: err });
  }
}
