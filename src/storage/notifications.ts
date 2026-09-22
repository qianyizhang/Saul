// Kept separate from provider drafts so muting never requires a working API configuration.
export const NOTIFICATION_STORAGE_KEY = 'saul_mute_error_notifications';

export async function getErrorNotificationsMuted(): Promise<boolean> {
  const stored = await chrome.storage.local.get(NOTIFICATION_STORAGE_KEY);
  return stored[NOTIFICATION_STORAGE_KEY] === true;
}

export async function setErrorNotificationsMuted(muted: boolean): Promise<void> {
  await chrome.storage.local.set({ [NOTIFICATION_STORAGE_KEY]: muted });
}
