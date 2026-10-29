import { isRecord } from './value.mts';
import type { PlanEvent, PdfUrlAttachment } from './plan-protocol.mts';
import { eventData } from './sse.mts';

export class ResponseFailure extends Error {
  reason: string;
  constructor(message: string, reason = 'provider-error') {
    super(message);
    this.reason = reason;
  }
}
export function planError(body: unknown, status?: number, requestId?: string | null) {
  const error = isRecord(body) && isRecord(body.error) ? body.error : {};
  const code = typeof error.code === 'string' ? error.code : '';
  const messages: Record<string, string> = {
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
  const safe = (v: unknown) =>
    typeof v === 'string' && /^[\w./:-]{1,160}$/.test(v) ? v : undefined;
  return new ResponseFailure(
    `${detail}${status ? ` (HTTP ${status})` : ''}${safe(code) ? ` [${code}]` : ''}${safe(error.param) ? ` Field: ${error.param}.` : ''}${safe(requestId) ? ` Request: ${requestId}.` : ''}`,
    safe(code) || 'provider-error',
  );
}
export function responsesBody(
  {
    model,
    effort,
    systemPrompt,
    userPrompt,
    attachments,
  }: {
    model: string;
    effort?: string;
    systemPrompt: string;
    userPrompt: string;
    attachments?: PdfUrlAttachment[];
  },
  serviceTier = 'default',
) {
  // This allowlist is deliberately separate from Chat Completions options.
  return {
    model,
    ...(systemPrompt ? { instructions: systemPrompt } : {}),
    input: [
      {
        role: 'user',
        content: attachments?.length
          ? [
              { type: 'input_text', text: userPrompt },
              ...attachments.map((attachment) => ({
                type: 'input_file',
                file_url: attachment.url,
              })),
            ]
          : userPrompt,
      },
    ],
    store: false,
    stream: true,
    service_tier: serviceTier === 'fast' ? 'priority' : serviceTier,
    ...(effort ? { reasoning: { effort } } : {}),
  };
}
export async function* responseEvents(response: Response): AsyncGenerator<PlanEvent> {
  const requestId = response.headers.get('x-request-id');
  if (!response.ok)
    throw planError(await response.json().catch(() => null), response.status, requestId);
  if (!response.body) throw new ResponseFailure('Response streaming is unavailable.');
  for await (const data of eventData(response.body)) {
    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      throw new ResponseFailure('Invalid Responses stream event.');
    }
    if (!isRecord(event) || typeof event.type !== 'string')
      throw new ResponseFailure('Invalid Responses stream event.');
    if (event.type === 'response.created') {
      yield { type: 'activity', phase: 'waiting' };
    } else if (
      event.type === 'response.output_item.added' &&
      isRecord(event.item) &&
      event.item.type === 'reasoning'
    ) {
      yield { type: 'activity', phase: 'thinking' };
    } else if (
      event.type === 'response.output_text.delta' ||
      event.type === 'response.refusal.delta'
    ) {
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
