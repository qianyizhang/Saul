// Window IDs belong to the current browser run. Session storage survives service
// worker/MCP reconnects without attaching old labels to a later browser's IDs.
const WINDOW_LABELS_KEY = 'saul_window_labels';

function windowLabelsFromStorage(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([id, title]) => /^\d+$/.test(id) && typeof title === 'string' && title.length <= 1000,
    ),
  );
}

export async function getWindowLabels(): Promise<Record<string, string>> {
  const stored = await chrome.storage.session.get(WINDOW_LABELS_KEY);
  return windowLabelsFromStorage(stored[WINDOW_LABELS_KEY]);
}

export async function saveWindowLabels(labels: Record<string, string>): Promise<void> {
  await chrome.storage.session.set({ [WINDOW_LABELS_KEY]: labels });
}
