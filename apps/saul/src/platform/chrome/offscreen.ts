let creatingOffscreen: Promise<void> | null = null;
export async function ensureOffscreenDocument(): Promise<void> {
  if (!chrome.offscreen) throw new Error('Offscreen storage requires Chrome.');
  if (creatingOffscreen) return creatingOffscreen;
  creatingOffscreen = (async () => {
    if (await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Persistent reading jobs and source/migration workers',
    });
  })();
  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}
