import { generateImage } from './images';
import { executionModel, validateModelPrompts, type ModelRequest } from './request';
import { streamOpenAICompatible } from './openai-compatible';
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
  signal?.throwIfAborted();
  const route = executionModel(input);
  validateModelPrompts(input);
  if (options.attachments?.length && route.provider !== 'chatgpt-plan')
    throw new Error(
      'PDF URL attachments need a ChatGPT plan preset. Choose Local parsing in Settings → Calls and Run again to send text.',
    );
  const connectionKey = route.binding.kind === 'connection' ? route.binding.key : undefined;
  if (route.provider === 'chatgpt-plan') {
    for await (const event of planEvents(
      {
        action: 'generate',
        ...route.plan,
        ...(connectionKey ? { connectionKey } : {}),
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        ...(options.attachments ? { attachments: options.attachments } : {}),
        ...(options.images ? { images: options.images } : {}),
      },
      signal,
      route.owner,
    ))
      if (event.type === 'delta' || event.type === 'complete' || event.type === 'activity')
        yield event;
    return;
  }
  if (route.capability === 'speak') throw new Error('Choose a Write or Draw preset.');
  if (connectionKey) {
    const reply = await credentialCall(
      { action: 'connection-catalog', connectionKey },
      signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    );
    if (!validConnectionCatalog(reply.catalog))
      throw new Error('Could not verify this connection’s models. Open Settings.');
    const issue = catalogIssue(reply.catalog, route.model);
    if (issue) throw new Error(issue);
  }
  if (route.capability === 'draw') {
    yield { type: 'activity', phase: 'waiting' };
    yield { type: 'image', image: await generateImage(route, input, credential, signal) };
    yield { type: 'complete' };
    return;
  }
  yield* streamOpenAICompatible(
    {
      baseUrl: route.endpoint,
      model: route.model,
      temperature: route.temperature,
      ...(route.owner === 'saul'
        ? { credentialOwner: route.owner, connectionKey, apiKey: '' }
        : { apiKey: credential }),
      maxTokens: options.maxTokens,
      images: options.images,
    },
    input.systemPrompt,
    input.userPrompt,
    signal,
  );
}
