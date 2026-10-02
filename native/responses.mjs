import { eventData } from './sse.mjs';

export class ResponseFailure extends Error {
  constructor(message, reason = 'provider-error') {
    super(message);
    this.reason = reason;
  }
}
export function planError(body, status, requestId) {
  const code = body?.error?.code;
  const messages = {
    subscription_sharing_usage_limit_exceeded:
      'ChatGPT plan or app usage limit reached. Manage usage at https://chatgpt.com/settings/usage before retrying.',
    subscription_sharing_user_not_eligible:
      'ChatGPT plan usage is unavailable for this account or workspace.',
    subscription_sharing_usage_unavailable:
      'ChatGPT usage is temporarily unavailable. Try again later.',
    subscription_sharing_unsupported_capability:
      'This request uses an unsupported ChatGPT plan capability.',
    subscription_sharing_route_not_supported: 'This route is not supported for ChatGPT plan usage.',
    subscription_sharing_invalid_user: 'ChatGPT could not validate this session. Sign in again.',
  };
  const detail =
    messages[code] || 'ChatGPT request failed. Check account permission or try again later.';
  // Never relay arbitrary upstream text: it can echo credentials or prompts.
  const safe = (v) => (typeof v === 'string' && /^[\w./:-]{1,160}$/.test(v) ? v : undefined);
  return new ResponseFailure(
    `${detail}${status ? ` (HTTP ${status})` : ''}${safe(code) ? ` [${code}]` : ''}${safe(body?.error?.param) ? ` Field: ${body.error.param}.` : ''}${safe(requestId) ? ` Request: ${requestId}.` : ''}`,
    safe(code) || 'provider-error',
  );
}
export function responsesBody({ model, systemPrompt, userPrompt }) {
  // This allowlist is deliberately separate from Chat Completions options.
  return {
    model,
    instructions: systemPrompt,
    input: [{ role: 'user', content: userPrompt }],
    store: false,
    stream: true,
  };
}
export async function* responseEvents(response) {
  const requestId = response.headers.get('x-request-id');
  if (!response.ok)
    throw planError(await response.json().catch(() => null), response.status, requestId);
  if (!response.body) throw new ResponseFailure('Response streaming is unavailable.');
  for await (const data of eventData(response.body)) {
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      throw new ResponseFailure('Invalid Responses stream event.');
    }
    if (!event || typeof event.type !== 'string')
      throw new ResponseFailure('Invalid Responses stream event.');
    if (event.type === 'response.output_text.delta') {
      if (typeof event.delta !== 'string')
        throw new ResponseFailure('Invalid Responses text delta.');
      yield { type: 'delta', text: event.delta };
    } else if (event.type === 'response.failed' || event.type === 'error') {
      throw planError(event.response || { error: event }, undefined, requestId);
    } else if (event.type === 'response.incomplete') {
      throw new ResponseFailure(
        'ChatGPT returned an incomplete response. Partial text was retained.',
        'incomplete',
      );
    } else if (event.type === 'response.completed') {
      yield { type: 'complete' };
      return;
    }
  }
  throw new ResponseFailure(
    'The stream ended without response.completed. Partial text was retained.',
    'unexpected-eof',
  );
}
