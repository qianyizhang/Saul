import { generateImage } from './images';
import type { ModelRequest } from './request';
import { streamOpenAICompatible } from './openai-compatible';
import { CHROME_AI_RETIRED_MESSAGE } from './retired-provider';
import { planEvents } from './chatgpt-plan';
import type { ModelEvent } from './events';
import { credentialCall } from '../native/credentials';
import { catalogIssue, validConnectionCatalog } from '../../native/connections-contract.mts';
import type { PdfUrlAttachment } from '../../native/plan-protocol.mts';

export async function* streamModel(
  input: ModelRequest,
  credential: string,
  signal?: AbortSignal,
  options: { maxTokens?: number; attachments?: PdfUrlAttachment[]; images?: string[] } = {},
): AsyncGenerator<ModelEvent> {
  if (options.attachments?.length && input.provider !== 'chatgpt-plan')
    throw new Error(
      'PDF URL attachments need a ChatGPT plan preset. Choose Local parsing in Settings → Calls and Run again to send text.',
    );
  if (
    input.provider !== 'chatgpt-plan' &&
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
          images: options.images,
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
          ...(input.preset?.connectionKey ? { connectionKey: input.preset.connectionKey } : {}),
          systemPrompt: input.systemPrompt,
          userPrompt: input.userPrompt,
          ...(options.attachments ? { attachments: options.attachments } : {}),
          ...(options.images ? { images: options.images } : {}),
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
