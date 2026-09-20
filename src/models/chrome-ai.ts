import type { ModelEvent } from './events';
export interface ChromeAiConfig {
  temperature?: number;
  topK?: number;
  outputLanguage?: string;
}
interface ModelSession {
  promptStreaming(prompt: string, options: { signal?: AbortSignal }): AsyncIterable<string>;
  destroy(): void;
}
interface LanguageModelFactory {
  availability(): Promise<string>;
  create(options: {
    signal?: AbortSignal;
    initialPrompts?: { role: 'system'; content: string }[];
    temperature?: number;
    topK?: number;
    expectedOutputs?: { type: 'text'; languages: string[] }[];
    monitor?: (monitor: EventTarget) => void;
  }): Promise<ModelSession>;
}
const factory = () =>
  (globalThis as unknown as { LanguageModel?: LanguageModelFactory }).LanguageModel;
export async function chromeAiAvailability(): Promise<string> {
  try {
    return (await factory()?.availability()) || 'unavailable';
  } catch {
    return 'unavailable';
  }
}
export async function prepareChromeAi(signal?: AbortSignal, progress?: (fraction: number) => void) {
  const lm = factory();
  if (!lm)
    throw new Error(
      'Chrome on-device AI is unavailable in this browser. Choose an OpenAI-compatible provider.',
    );
  const session = await lm.create({
    signal,
    monitor: (monitor) =>
      monitor.addEventListener('downloadprogress', (event) =>
        progress?.((event as Event & { loaded: number }).loaded),
      ),
  });
  session.destroy();
}
export async function* streamChromeAi(
  config: ChromeAiConfig,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
): AsyncGenerator<ModelEvent, void, unknown> {
  const lm = factory();
  if (!lm)
    throw new Error('Chrome on-device AI is unavailable. Choose a different provider in Settings.');
  const availability = await chromeAiAvailability();
  if (availability !== 'available')
    throw new Error(
      'Prepare the on-device model from Saul Settings first. Availability: ' + availability,
    );
  const session = await lm.create({
    initialPrompts: [{ role: 'system', content: systemPrompt }],
    temperature: config.temperature ?? 0.3,
    topK: config.topK ?? 3,
    signal,
    ...(config.outputLanguage
      ? { expectedOutputs: [{ type: 'text', languages: [config.outputLanguage] }] }
      : {}),
  });
  try {
    for await (const text of session.promptStreaming(userPrompt, { signal })) {
      if (signal?.aborted) return;
      if (text) yield { type: 'delta', text };
    }
    if (!signal?.aborted) yield { type: 'complete' };
  } finally {
    session.destroy();
  }
}
