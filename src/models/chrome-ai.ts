import type { ModelEvent } from './events';
// Temporarily paused while live Chrome model setup remains unverified.
export const CHROME_AI_ENABLED = false;
export const CHROME_AI_DISABLED_MESSAGE =
  'Chrome on-device AI is temporarily disabled. Choose ChatGPT plan or OpenAI compatible in Settings.';
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
  availability(options?: {
    expectedOutputs?: { type: 'text'; languages: string[] }[];
  }): Promise<string>;
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
const outputOptions = (config: ChromeAiConfig) =>
  config.outputLanguage
    ? { expectedOutputs: [{ type: 'text' as const, languages: [config.outputLanguage] }] }
    : {};
export async function chromeAiAvailability(config: ChromeAiConfig = {}): Promise<string> {
  const lm = factory();
  if (!lm) return 'unsupported';
  return lm.availability(outputOptions(config));
}
export async function prepareChromeAi(signal?: AbortSignal, progress?: (fraction: number) => void) {
  const lm = factory();
  if (!lm)
    throw new Error(
      'This browser does not expose the Chrome Prompt API. Update Google Chrome and check its built-in AI support.',
    );
  const session = await lm.create({
    signal,
    monitor: (monitor) =>
      monitor.addEventListener('downloadprogress', (event) =>
        progress?.((event as Event & { loaded: number }).loaded),
      ),
  });
  session.destroy();
  const availability = await chromeAiAvailability();
  if (availability !== 'available')
    throw new Error(
      `Chrome on-device model is not ready (availability: ${availability}). Check chrome://on-device-internals for model eligibility and download errors.`,
    );
  return availability;
}
export async function* streamChromeAi(
  config: ChromeAiConfig,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
): AsyncGenerator<ModelEvent, void, unknown> {
  const lm = factory();
  if (!lm)
    throw new Error(
      'This browser does not expose the Chrome Prompt API. Update Google Chrome and check its built-in AI support.',
    );
  const availability = await chromeAiAvailability(config);
  if (availability === 'unavailable')
    throw new Error(
      'Chrome reports that its on-device model is unavailable. Check chrome://on-device-internals for model eligibility and download errors.',
    );
  if (availability !== 'available')
    throw new Error(
      'Prepare the on-device model from Saul Settings first. Availability: ' + availability,
    );
  const session = await lm.create({
    initialPrompts: [{ role: 'system', content: systemPrompt }],
    temperature: config.temperature ?? 0.3,
    topK: config.topK ?? 3,
    signal,
    ...outputOptions(config),
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
