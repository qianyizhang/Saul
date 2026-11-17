import { SETTINGS_STORAGE_KEY, type ConfigurationStorage } from './store';

/** Trusted-context adapter. The settings owner decides what to write and when. */
export const chromeConfigurationStorage: ConfigurationStorage = {
  async read() {
    try {
      const result = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
      return result[SETTINGS_STORAGE_KEY] as unknown;
    } catch (cause) {
      throw new Error('Could not read saved settings. Reload Saul and try again.', { cause });
    }
  },
  write: (values) => chrome.storage.local.set(values),
};

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
