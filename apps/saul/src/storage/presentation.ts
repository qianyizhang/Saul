// Presentation is independent of provider drafts and never changes model settings.
export const MINIMUM_MODE_STORAGE_KEY = 'saul_minimum_mode';

export const minimumModeFromStorage = (value: unknown): boolean => value !== false;

export async function getMinimumMode(): Promise<boolean> {
  const stored = await chrome.storage.local.get(MINIMUM_MODE_STORAGE_KEY);
  return minimumModeFromStorage(stored[MINIMUM_MODE_STORAGE_KEY]);
}

export async function setMinimumMode(minimum: boolean): Promise<void> {
  await chrome.storage.local.set({ [MINIMUM_MODE_STORAGE_KEY]: minimum });
}
