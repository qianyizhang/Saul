export interface ChromeAiConfig {
  temperature?: number;
  topK?: number;
}

// Global declaration for Chrome built-in LanguageModel
declare global {
  interface Window {
    ai?: {
      languageModel?: {
        capabilities?: () => Promise<{ available: string }>;
        availability?: () => Promise<string>;
        create?: (options?: any) => Promise<any>;
      };
    };
    LanguageModel?: {
      availability?: () => Promise<string>;
      params?: () => Promise<any>;
      create?: (options?: any) => Promise<any>;
    };
  }
}

export async function isChromeAiAvailable(): Promise<boolean> {
  try {
    if (typeof (globalThis as any).LanguageModel?.availability === 'function') {
      const status = await (globalThis as any).LanguageModel.availability();
      return status === 'readily' || status === 'after-download';
    }

    const ai = (globalThis as any).ai?.languageModel;
    if (ai) {
      if (typeof ai.availability === 'function') {
        const status = await ai.availability();
        return status === 'readily' || status === 'after-download';
      }
      if (typeof ai.capabilities === 'function') {
        const caps = await ai.capabilities();
        return caps.available === 'readily' || caps.available === 'after-download';
      }
    }
  } catch {
    // Chrome AI not available
  }
  return false;
}

export async function* streamChromeAi(
  config: ChromeAiConfig,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const lmFactory = (globalThis as any).LanguageModel || (globalThis as any).ai?.languageModel;

  if (!lmFactory || typeof lmFactory.create !== 'function') {
    throw new Error('Chrome Built-in Prompt API is not supported in this browser version.');
  }

  const session = await lmFactory.create({
    systemPrompt,
    temperature: config.temperature ?? 0.3,
    topK: config.topK ?? 3,
    signal,
  });

  try {
    const stream = session.promptStreaming(userPrompt, { signal });
    let previousText = '';

    for await (const chunk of stream) {
      if (signal?.aborted) break;
      // Chrome Prompt API yields the cumulative text in each chunk
      const delta = chunk.slice(previousText.length);
      previousText = chunk;
      if (delta) {
        yield delta;
      }
    }
  } finally {
    if (typeof session.destroy === 'function') {
      session.destroy();
    }
  }
}
