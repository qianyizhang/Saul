export interface ChromeAiConfig {
  temperature?: number;
  topK?: number;
  outputLanguage?: string;
}
const factory = () => (globalThis as any).LanguageModel || (globalThis as any).ai?.languageModel;
export async function chromeAiAvailability(): Promise<string> {
  try {
    const lm = factory();
    if (!lm) return 'unavailable';
    const status = lm.availability
      ? await lm.availability()
      : (await lm.capabilities?.())?.available;
    return status === 'readily'
      ? 'available'
      : status === 'after-download'
        ? 'downloadable'
        : status || 'unavailable';
  } catch {
    return 'unavailable';
  }
}
export async function isChromeAiAvailable() {
  return (await chromeAiAvailability()) === 'available';
}
export async function prepareChromeAi(signal?: AbortSignal, progress?: (fraction: number) => void) {
  const lm = factory();
  if (!lm?.create)
    throw new Error(
      'Chrome on-device AI is unavailable in this browser. Choose an OpenAI-compatible provider.',
    );
  const session = await lm.create({
    signal,
    monitor: (monitor: any) =>
      monitor.addEventListener('downloadprogress', (event: any) => progress?.(event.loaded)),
  });
  session.destroy();
}
export async function* streamChromeAi(
  config: ChromeAiConfig,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  const lm = factory();
  if (!lm?.create)
    throw new Error('Chrome on-device AI is unavailable. Choose a different provider in Settings.');
  const availability = await chromeAiAvailability();
  if (availability !== 'available')
    throw new Error(
      'Prepare the on-device model from Saul Settings first. Availability: ' + availability,
    );
  const modern = Boolean((globalThis as any).LanguageModel);
  const session = await lm.create({
    ...(modern
      ? { initialPrompts: [{ role: 'system', content: systemPrompt }] }
      : { systemPrompt }),
    temperature: config.temperature ?? 0.3,
    topK: config.topK ?? 3,
    signal,
    ...(config.outputLanguage
      ? { expectedOutputs: [{ type: 'text', languages: [config.outputLanguage] }] }
      : {}),
  });
  try {
    let previous = '';
    for await (const chunk of session.promptStreaming(userPrompt, { signal })) {
      if (signal?.aborted) return;
      // Current LanguageModel streams deltas; the legacy window.ai API emitted cumulative text.
      const delta = modern ? chunk : chunk.slice(previous.length);
      previous = chunk;
      if (delta) yield delta;
    }
  } finally {
    session.destroy?.();
  }
}
