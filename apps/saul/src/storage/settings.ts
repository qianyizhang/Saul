import type { UserSettings } from '../types';
import { DEFAULT_SYSTEM_PROMPT } from '../models/prompts';
import { CHROME_AI_ENABLED, CHROME_AI_DISABLED_MESSAGE } from '../models/chrome-ai';
import { normalizeConfiguration, starterConfiguration } from '../models/configuration';
import { validateSettingsRequest, type SettingsState } from '../contracts/settings';

const DEFAULT_CONNECTION_SETTINGS: UserSettings = {
  activeProvider: 'openai-compatible',
  openaiCompatible: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    temperature: 0.3,
  },
  chromeAi: {
    temperature: 0.3,
    topK: 3,
  },
  contextPolicy: {
    includeSelection: true,
    includeContainingParagraph: true,
    includeContainingHeading: true,
    includePageMetadata: true,
  },
  customPromptTemplate: DEFAULT_SYSTEM_PROMPT,
};
export const DEFAULT_SETTINGS: UserSettings = {
  ...DEFAULT_CONNECTION_SETTINGS,
  summaryPdfProcessing: 'attachment',
  configuration: starterConfiguration(DEFAULT_CONNECTION_SETTINGS),
};

export const SETTINGS_STORAGE_KEY = 'saul_user_settings';
const RECOVERY_BACKUP_KEY = 'saul_user_settings_recovery_backup';

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
  fallback = DEFAULT_SETTINGS.openaiCompatible,
): UserSettings['openaiCompatible'] {
  if (value === undefined) return { ...fallback };
  const stored = record(value, 'OpenAI-compatible settings');
  return {
    baseUrl: optionalString(stored.baseUrl, 'model endpoint') ?? fallback.baseUrl,
    apiKey: optionalString(stored.apiKey, 'API key') ?? fallback.apiKey,
    model: optionalString(stored.model, 'model name') ?? fallback.model,
    temperature: optionalNumber(stored.temperature, 'provider temperature') ?? fallback.temperature,
  };
}

function recoveredProfileId(profiles: UserSettings['profiles']): string {
  const existing = new Set(profiles?.map((profile) => profile.id));
  let id = 'recovered-current';
  for (let suffix = 2; existing.has(id); suffix += 1) id = `recovered-current-${suffix}`;
  return id;
}

function normalizeSettings(value: unknown): UserSettings {
  const stored = record(value, 'settings');
  const activeProvider = stored.activeProvider ?? DEFAULT_SETTINGS.activeProvider;
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
  let profiles =
    stored.profiles === undefined
      ? undefined
      : (() => {
          if (!Array.isArray(stored.profiles))
            throw new Error('Saved provider profiles must be a list.');
          const ids = new Set<string>();
          return stored.profiles.map((value, index) => {
            const profile = record(value, `provider profile ${index + 1}`);
            const id = optionalString(profile.id, 'profile ID');
            const name = optionalString(profile.name, 'profile name');
            if (!id || name === undefined)
              throw new Error('Saved provider profiles require an ID and name.');
            if (ids.has(id)) throw new Error('Saved provider profile IDs must be unique.');
            ids.add(id);
            return { id, name, config: normalizeRemoteConfig(profile.config) };
          });
        })();
  let activeProfileId = optionalString(stored.activeProfileId, 'active profile ID');
  if (profiles && !profiles.some((profile) => profile.id === activeProfileId)) {
    const id = activeProfileId || recoveredProfileId(profiles);
    profiles = [
      ...profiles,
      {
        id,
        name: 'Recovered current settings',
        config: { ...openaiCompatible },
      },
    ];
    activeProfileId = id;
  }
  const responseLanguage = optionalString(stored.responseLanguage, 'response language');
  if (stored.configuration === undefined && profiles) {
    const active = profiles.find((profile) => profile.id === activeProfileId);
    if (active && JSON.stringify(active.config) !== JSON.stringify(openaiCompatible)) {
      // Older records executed the top-level connection. Preserve both it and the
      // independently saved profile instead of changing the request destination.
      const id = recoveredProfileId(profiles);
      profiles = [
        ...profiles,
        { id, name: 'Recovered current settings', config: { ...openaiCompatible } },
      ];
      activeProfileId = id;
    }
  }
  const customPromptTemplate = optionalString(stored.customPromptTemplate, 'custom prompt');
  const summaryPdfProcessing =
    stored.summaryPdfProcessing === undefined
      ? DEFAULT_SETTINGS.summaryPdfProcessing
      : stored.summaryPdfProcessing;
  if (summaryPdfProcessing !== 'attachment' && summaryPdfProcessing !== 'local')
    throw new Error('Saved PDF processing must be attachment or local.');

  const settings: UserSettings = {
    ...DEFAULT_SETTINGS,
    summaryPdfProcessing,
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
        DEFAULT_SETTINGS.chromeAi.temperature,
      topK: optionalNumber(chromeAi.topK, 'Chrome AI top K') ?? DEFAULT_SETTINGS.chromeAi.topK,
    },
    contextPolicy: {
      includeSelection:
        optionalBoolean(contextPolicy.includeSelection, 'include-selection setting') ??
        DEFAULT_SETTINGS.contextPolicy.includeSelection,
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
        DEFAULT_SETTINGS.contextPolicy.includeContainingParagraph,
      includeContainingHeading:
        optionalBoolean(contextPolicy.includeContainingHeading, 'heading-context setting') ??
        DEFAULT_SETTINGS.contextPolicy.includeContainingHeading,
      includePageMetadata:
        optionalBoolean(contextPolicy.includePageMetadata, 'page-metadata setting') ??
        DEFAULT_SETTINGS.contextPolicy.includePageMetadata,
    },
    ...(profiles ? { profiles } : {}),
    ...(activeProfileId === undefined ? {} : { activeProfileId }),
    ...(responseLanguage === undefined ? {} : { responseLanguage }),
    ...(customPromptTemplate === undefined ? {} : { customPromptTemplate }),
  };
  settings.configuration = normalizeConfiguration(stored.configuration, settings);
  return settings;
}

export function validateProviderSettings(settings: UserSettings): URL | undefined {
  if (settings.activeProvider === 'chrome-ai') {
    if (!CHROME_AI_ENABLED) throw new Error(CHROME_AI_DISABLED_MESSAGE);
    return undefined;
  }
  if (settings.activeProvider === 'chatgpt-plan') {
    if (!settings.chatgptPlan?.accountId || !settings.chatgptPlan.model.trim())
      throw new Error('Choose a ChatGPT account and model.');
    return undefined;
  }
  let endpoint: URL;
  try {
    endpoint = new URL(settings.openaiCompatible.baseUrl);
  } catch {
    throw new Error('Enter a valid model endpoint URL.');
  }
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error(
      'Use an HTTP(S) endpoint without credentials, query parameters, or a fragment.',
    );
  if (!settings.openaiCompatible.model.trim())
    throw new Error('Enter a model name available from this provider.');
  return endpoint;
}

export function isLoopbackEndpoint(endpoint: URL): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
}

async function readStoredSettings(): Promise<unknown> {
  try {
    const result = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
    return result[SETTINGS_STORAGE_KEY];
  } catch (err) {
    throw new Error('Could not read saved settings. Reload Saul and try again.', { cause: err });
  }
}

export async function getSettings(): Promise<UserSettings> {
  const stored = await readStoredSettings();
  return settingsFromStored(stored);
}

export interface SharedPresetAccess {
  load(settings: UserSettings): Promise<UserSettings>;
  save(settings: UserSettings): Promise<UserSettings>;
}

function settingsFromStored(stored: unknown): UserSettings {
  if (stored === undefined) return structuredClone(DEFAULT_SETTINGS);
  try {
    return normalizeSettings(stored);
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Their format is not supported.';
    throw new InvalidStoredSettingsError(detail, { cause: err });
  }
}

async function revisionOf(stored: unknown): Promise<string> {
  // Hash the raw record, including unknown fields, without exposing credentials
  // in a revision or rewriting legacy records merely because they were read.
  // Chrome may reorder object keys on storage round trips; array order matters.
  const serialized = JSON.stringify(stored, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : value,
  );
  const bytes = new TextEncoder().encode(serialized ?? 'absent');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface SettingsStorage {
  read(): Promise<unknown>;
  write(values: Record<string, unknown>): Promise<void>;
}

/** One instance in the background serializes every configuration read and write. */
export function createSettingsOwner(
  storage: SettingsStorage = {
    read: readStoredSettings,
    write: (values) => chrome.storage.local.set(values),
  },
  shared?: SharedPresetAccess,
): (request: unknown) => Promise<SettingsState> {
  let pending: Promise<unknown> = Promise.resolve();
  return (value) => {
    // Freeze direct callers too; Chrome messages already arrive as copies.
    const request: unknown = structuredClone(value);
    const result = pending.then(async (): Promise<SettingsState> => {
      validateSettingsRequest(request);
      const stored = await storage.read();
      let loaded: UserSettings | undefined;
      try {
        loaded = settingsFromStored(stored);
        if (shared) loaded = await shared.load(loaded);
      } catch (error) {
        if (!(error instanceof InvalidStoredSettingsError)) throw error;
      }
      // The only migration write: retain remapped recipe IDs and local account bindings.
      if (
        request.action === 'read' &&
        shared &&
        loaded?.sharedPresetRevision !== undefined &&
        settingsFromStored(stored).sharedPresetRevision === undefined
      ) {
        await storage.write({ [SETTINGS_STORAGE_KEY]: loaded });
        return {
          state: 'ready',
          settings: loaded,
          revision: await revisionOf({
            stored: loaded,
            sharedRevision: loaded.sharedPresetRevision,
          }),
        };
      }
      const revision = await revisionOf(
        shared ? { stored, sharedRevision: loaded?.sharedPresetRevision } : stored,
      );
      if (request.action !== 'read' && request.baseline !== revision)
        return {
          state: 'conflict',
          error:
            'Settings changed in another surface. Your draft is still here. Reload saved settings to continue.',
        };

      if (request.action === 'commit') {
        settingsFromStored(stored); // Invalid originals require explicit backed-up recovery.
        // Normalize and validate in the write owner, not only in the form.
        let settings = normalizeSettings(request.settings);
        validateProviderSettings(settings);
        if (shared) settings = await shared.save(settings);
        try {
          await storage.write({ [SETTINGS_STORAGE_KEY]: settings });
        } catch (cause) {
          if (!shared) throw cause;
          throw new Error(
            'Settings could not be saved. Shared presets may already be saved; reload saved settings before saving again.',
            { cause },
          );
        }
        return {
          state: 'ready',
          settings,
          revision: await revisionOf(
            shared ? { stored: settings, sharedRevision: settings.sharedPresetRevision } : settings,
          ),
        };
      }

      try {
        return {
          state: 'ready',
          revision,
          settings: loaded ?? settingsFromStored(stored),
          ...(request.action === 'reset' ? { reset: false } : {}),
        };
      } catch (error) {
        if (!(error instanceof InvalidStoredSettingsError)) throw error;
        if (request.action === 'read') return { state: 'invalid', revision, error: error.message };
      }
      let settings = structuredClone(DEFAULT_SETTINGS);
      if (shared) settings = await shared.load(settings);
      try {
        await storage.write({
          [RECOVERY_BACKUP_KEY]: stored,
          [SETTINGS_STORAGE_KEY]: settings,
        });
      } catch (cause) {
        throw new Error('Could not back up and reset saved settings. Try again.', { cause });
      }
      return {
        state: 'ready',
        revision: await revisionOf(
          shared ? { stored: settings, sharedRevision: settings.sharedPresetRevision } : settings,
        ),
        settings,
        reset: true,
      };
    });
    pending = result.catch(() => {});
    return result;
  };
}

export async function initStorageSecurity(): Promise<void> {
  try {
    if (typeof chrome.storage.local.setAccessLevel === 'function') {
      await chrome.storage.local.setAccessLevel({
        accessLevel: 'TRUSTED_CONTEXTS',
      });
    }
  } catch (err) {
    console.warn('Could not set storage access level (may not be supported in this context):', err);
  }
}
