import { eventData } from '../../shared/protocol/sse.mts';
import { isRecord } from '../../shared/model/value.mts';
import { IncompleteGeneration, type ModelEvent } from '../../shared/model/model-events.ts';
import { credentialEvents } from '../native/credentials';
export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey: string;
  credentialOwner?: 'saul';
  connectionKey?: string;
  runGeneration?: string;
  images?: string[];
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export async function* streamOpenAICompatible(
  config: OpenAICompatibleConfig,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
): AsyncGenerator<ModelEvent, void, unknown> {
  if (config.credentialOwner === 'saul') {
    if (
      !config.connectionKey &&
      !['https://api.openai.com/v1', 'https://api.openai.com/v1/chat/completions'].includes(
        config.baseUrl.replace(/\/+$/, ''),
      )
    )
      throw new Error('The shared OpenAI credential cannot be used with a different endpoint.');
    for await (const event of credentialEvents(
      {
        action: 'api-chat',
        ...(config.connectionKey ? { connectionKey: config.connectionKey } : {}),
        ...(config.runGeneration ? { runGeneration: config.runGeneration } : {}),
        model: config.model,
        systemPrompt,
        userPrompt,
        ...(config.images ? { images: config.images } : {}),
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      },
      signal,
    )) {
      if (event.type === 'delta' || event.type === 'complete' || event.type === 'activity')
        yield event;
    }
    return;
  }
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const url = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  const body = {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: config.images?.length
          ? [
              { type: 'text', text: userPrompt },
              ...config.images.map((url) => ({ type: 'image_url', image_url: { url } })),
            ]
          : userPrompt,
      },
    ],
    temperature: config.temperature ?? 0.3,
    stream: true,
    max_tokens: config.maxTokens ?? 1024,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`LLM Request failed (${response.status}): ${errorText || response.statusText}`);
  }

  if (!response.body) {
    throw new Error('Response body is null, streaming unavailable');
  }

  let answered = false;
  for await (const data of eventData(response.body)) {
    const marker = data.trim();
    if (!marker) continue;
    if (marker === '[DONE]') {
      if (!answered)
        throw new IncompleteGeneration('incomplete', 'The model completed without returning text.');
      yield { type: 'complete' };
      return;
    }
    const invalid = () =>
      new Error('The model returned an invalid streaming response. Please retry.');
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      throw invalid();
    }
    if (!isRecord(parsed)) throw invalid();
    if (parsed.error != null)
      throw new Error(
        isRecord(parsed.error) && typeof parsed.error.message === 'string'
          ? parsed.error.message
          : 'The provider reported a streaming error.',
      );
    const choices: unknown = parsed.choices;
    if (!Array.isArray(choices)) throw invalid();
    if (choices.length === 0 && isRecord(parsed.usage)) continue;
    const choice: unknown = choices[0];
    if (choices.length !== 1 || !isRecord(choice) || !isRecord(choice.delta)) throw invalid();
    const { content, role, tool_calls, function_call } = choice.delta;
    if (role != null && typeof role !== 'string') throw invalid();
    const reason = choice.finish_reason;
    if (reason != null && typeof reason !== 'string') throw invalid();
    if (
      (content != null && typeof content !== 'string') ||
      tool_calls != null ||
      function_call != null
    )
      throw new Error('The model returned non-text content. Choose a text model.');
    if (typeof content === 'string' && content) {
      answered ||= !!content.trim();
      yield { type: 'delta', text: content };
    }
    if (reason != null) {
      if (reason !== 'stop') {
        const code = /^[a-z][a-z0-9_-]{0,63}$/.test(reason) ? reason : 'incomplete';
        throw new IncompleteGeneration(
          code,
          `The model stopped with ${code}. The partial explanation was retained.`,
        );
      }
      yield { type: 'complete' };
      return;
    }
  }
  throw new IncompleteGeneration(
    'unexpected-eof',
    'The connection ended without a completion signal. Retry the incomplete explanation.',
  );
}
