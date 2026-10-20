import type { RunInput } from '../types/storage';
import { streamOpenAICompatible } from './openai-compatible';
import { streamChromeAi, CHROME_AI_ENABLED, CHROME_AI_DISABLED_MESSAGE } from './chrome-ai';
import { planEvents } from './chatgpt-plan';
import type { ModelEvent } from './events';

export async function* streamModel(
  input: RunInput,
  credential: string,
  signal?: AbortSignal,
  options: { maxTokens?: number } = {},
): AsyncGenerator<ModelEvent> {
  switch (input.provider) {
    case 'openai-compatible':
      yield* streamOpenAICompatible(
        { ...input.remote, apiKey: credential, maxTokens: options.maxTokens },
        input.systemPrompt,
        input.userPrompt,
        signal,
      );
      return;
    case 'chrome-ai':
      if (!CHROME_AI_ENABLED) throw new Error(CHROME_AI_DISABLED_MESSAGE);
      yield* streamChromeAi(input.local, input.systemPrompt, input.userPrompt, signal);
      return;
    case 'chatgpt-plan':
      if (!input.plan?.accountId || !input.plan.model)
        throw new Error('Choose a ChatGPT account and model in Settings.');
      for await (const event of planEvents(
        {
          action: 'generate',
          ...input.plan,
          systemPrompt: input.systemPrompt,
          userPrompt: input.userPrompt,
        },
        signal,
      ))
        if (event.type === 'delta' || event.type === 'complete' || event.type === 'activity')
          yield event;
      return;
    default:
      throw new Error('Unsupported model provider.');
  }
}
