import { eventData } from '../../native/sse.mts';
import { IncompleteGeneration, type ModelEvent } from './events';
import { credentialEvents } from '../native/credentials';
export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey: string;
  credentialOwner?: 'saul';
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
      !['https://api.openai.com/v1', 'https://api.openai.com/v1/chat/completions'].includes(
        config.baseUrl.replace(/\/+$/, ''),
      )
    )
      throw new Error('The shared OpenAI credential cannot be used with a different endpoint.');
    for await (const event of credentialEvents(
      {
        action: 'api-chat',
        model: config.model,
        systemPrompt,
        userPrompt,
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
    model: config.model || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
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

  let finished = false;
  for await (const data of eventData(response.body)) {
    if (data.trim() === '[DONE]') {
      yield { type: 'complete' };
      return;
    }
    if (!data.trim()) continue;
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      throw new Error('The model returned an invalid streaming response. Please retry.');
    }
    if (parsed?.error)
      throw new Error(
        typeof parsed.error.message === 'string'
          ? parsed.error.message
          : 'The provider reported a streaming error.',
      );
    const delta = parsed?.choices?.[0]?.delta?.content;
    if (delta != null && typeof delta !== 'string')
      throw new Error('The model returned non-text content. Choose a text model.');
    if (delta) yield { type: 'delta', text: delta };
    const reason = parsed?.choices?.[0]?.finish_reason;
    if (reason != null) {
      if (reason !== 'stop')
        throw new IncompleteGeneration(
          String(reason),
          `The model stopped with ${reason}. The partial explanation was retained.`,
        );
      finished = true;
    }
  }
  if (!finished)
    throw new IncompleteGeneration(
      'unexpected-eof',
      'The connection ended without a completion signal. Retry the incomplete explanation.',
    );
  yield { type: 'complete' };
}
