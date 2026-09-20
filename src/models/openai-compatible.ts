import { IncompleteGeneration, type ModelEvent } from './events';
export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

// SSE data is delimited by blank lines, not network chunks. A data field may
// omit the space after ':' or span multiple lines within one event.
async function* readEventData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.search(/[\r\n]/)) !== -1) {
        // A CRLF pair can itself be split across reads.
        if (!done && buffer[end] === '\r' && end === buffer.length - 1) break;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + (buffer.slice(end, end + 2) === '\r\n' ? 2 : 1));
        if (!line) {
          if (data.length) yield data.join('\n');
          data = [];
        } else if (line === 'data' || line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ /, ''));
        }
      }
      if (done) {
        if (data.length || /^data(?::|$)/.test(buffer))
          throw new IncompleteGeneration(
            'truncated-event',
            'The model stream ended in an incomplete event. Please retry.',
          );
        return;
      }
    }
  } finally {
    // Stopping at [DONE], a provider error, or consumer cancellation must also
    // close the response body; releasing a reader alone leaves it running.
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function* streamOpenAICompatible(
  config: OpenAICompatibleConfig,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
): AsyncGenerator<ModelEvent, void, unknown> {
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
  for await (const data of readEventData(response.body)) {
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
