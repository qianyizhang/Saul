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

export async function getSettings(): Promise<UserSettings> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const stored = result[STORAGE_KEY] as Partial<UserSettings> | undefined;
    if (stored) {
      return {
        ...DEFAULT_SETTINGS,
        ...stored,
        openaiCompatible: {
          ...DEFAULT_SETTINGS.openaiCompatible,
          ...(stored.openaiCompatible || {}),
        },
        chromeAi: {
          ...DEFAULT_SETTINGS.chromeAi,
          ...(stored.chromeAi || {}),
        },
        contextPolicy: {
          ...DEFAULT_SETTINGS.contextPolicy,
          ...(stored.contextPolicy || {}),
        },
      };
    }
  } catch (err) {
    throw new Error('Could not load saved settings. Reload Saul and try again.', { cause: err });
  }
  return DEFAULT_SETTINGS;
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
    if (typeof (chrome.storage.local as any)?.setAccessLevel === 'function') {
      await (chrome.storage.local as any).setAccessLevel({
        accessLevel: 'TRUSTED_CONTEXTS',
      });
    }
  } catch (err) {
    console.warn('Could not set storage access level (may not be supported in this context):', err);
  }
}
