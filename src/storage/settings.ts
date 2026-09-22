import type { UserSettings } from '../types';
import { DEFAULT_SYSTEM_PROMPT } from '../models/prompts';

export const DEFAULT_SETTINGS: UserSettings = {
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

const STORAGE_KEY = 'saul_user_settings';
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
  if (activeProvider !== 'openai-compatible' && activeProvider !== 'chrome-ai')
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
  const customPromptTemplate = optionalString(stored.customPromptTemplate, 'custom prompt');

  return {
    ...DEFAULT_SETTINGS,
    activeProvider,
    openaiCompatible,
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
}

export function validateProviderSettings(settings: UserSettings): URL | undefined {
  if (settings.activeProvider === 'chrome-ai') return undefined;
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
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return result[STORAGE_KEY];
  } catch (err) {
    throw new Error('Could not read saved settings. Reload Saul and try again.', { cause: err });
  }
}

export async function getSettings(): Promise<UserSettings> {
  const stored = await readStoredSettings();
  if (stored === undefined) return DEFAULT_SETTINGS;
  try {
    return normalizeSettings(stored);
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Their format is not supported.';
    throw new InvalidStoredSettingsError(detail, { cause: err });
  }
}

export interface SettingsRecoveryResult {
  settings: UserSettings;
  reset: boolean;
}

export async function backupAndResetInvalidSettings(): Promise<SettingsRecoveryResult> {
  const stored = await readStoredSettings();
  if (stored === undefined) return { settings: DEFAULT_SETTINGS, reset: false };

  try {
    const settings = normalizeSettings(stored);
    return { settings, reset: false };
  } catch {
    // The user explicitly chose recovery after the settings screen reported invalid data.
  }

  try {
    await chrome.storage.local.set({
      [RECOVERY_BACKUP_KEY]: stored,
      [STORAGE_KEY]: DEFAULT_SETTINGS,
    });
  } catch (err) {
    throw new Error('Could not back up and reset saved settings. Try again.', { cause: err });
  }
  return { settings: DEFAULT_SETTINGS, reset: true };
}

export async function saveSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
  const current = await getSettings();
  const updated: UserSettings = {
    ...current,
    ...settings,
    openaiCompatible: {
      ...current.openaiCompatible,
      ...(settings.openaiCompatible || {}),
    },
    chromeAi: {
      ...current.chromeAi,
      ...(settings.chromeAi || {}),
    },
    contextPolicy: {
      ...current.contextPolicy,
      ...(settings.contextPolicy || {}),
    },
  };

  await chrome.storage.local.set({ [STORAGE_KEY]: updated });
  return updated;
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
