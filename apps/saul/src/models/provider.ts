import { generateImage } from './images';
import type { RunInput } from '../types/storage';
import { streamOpenAICompatible } from './openai-compatible';
import { CHROME_AI_RETIRED_MESSAGE } from './retired-provider';
import { planEvents } from './chatgpt-plan';
import type { ModelEvent } from './events';
import { credentialCall } from '../native/credentials';
import { catalogIssue, validConnectionCatalog } from '../../native/connections-contract.mts';

export async function* streamModel(
  input: RunInput,
  credential: string,
  signal?: AbortSignal,
  options: { maxTokens?: number } = {},
): AsyncGenerator<ModelEvent> {
  if (
    input.preset?.connectionKey &&
    (input.credentialOwner === 'saul' || input.remote.credentialOwner === 'saul')
  ) {
    const reply = await credentialCall(
      { action: 'connection-catalog', connectionKey: input.preset.connectionKey },
      signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    );
    if (!validConnectionCatalog(reply.catalog))
      throw new Error('Could not verify this connection’s models. Open Settings.');
    const issue = catalogIssue(reply.catalog, input.preset.model);
    if (issue) throw new Error(issue);
  }
  if (input.preset?.capability === 'draw') {
    yield { type: 'activity', phase: 'waiting' };
    yield { type: 'image', image: await generateImage(input, credential, signal) };
    yield { type: 'complete' };
    return;
  }
  switch (input.provider) {
    case 'openai-compatible':
      yield* streamOpenAICompatible(
        {
          ...input.remote,
          apiKey: credential,
          maxTokens: options.maxTokens,
          connectionKey: input.preset?.connectionKey,
        },
        input.systemPrompt,
        input.userPrompt,
        signal,
      );
      return;
    case 'chrome-ai':
      throw new Error(CHROME_AI_RETIRED_MESSAGE);
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
        input.credentialOwner ?? 'local',
      ))
        if (event.type === 'delta' || event.type === 'complete' || event.type === 'activity')
          yield event;
      return;
    default:
      throw new Error('Unsupported model provider.');
  }
}
