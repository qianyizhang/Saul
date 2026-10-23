import {
  PLAN_PORT,
  validatePlanResult,
  type PlanRequest,
  type PlanEvent,
  type PlanControlRequest,
  type PlanResult,
} from '../../native/plan-protocol.mts';
import { IncompleteGeneration } from './events';

export async function* planEvents(
  request: PlanRequest,
  signal?: AbortSignal,
): AsyncGenerator<PlanEvent> {
  signal?.throwIfAborted();
  const port = chrome.runtime.connect({ name: PLAN_PORT });
  const queue: PlanEvent[] = [];
  let wake = () => {},
    ended = false;
  const push = (event: PlanEvent) => {
    queue.push(event);
    wake();
  };
  const abort = () => {
    ended = true;
    wake();
    try {
      port.postMessage({ cancel: true });
    } catch {
      /* Already disconnected. */
    }
    port.disconnect();
  };
  port.onMessage.addListener((event: PlanEvent) => push(event));
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    if (!ended)
      push({ type: 'error', message: 'ChatGPT helper connection closed. Retry from Settings.' });
  });
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    port.postMessage(request);
    while (!ended) {
      if (!queue.length)
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      signal?.throwIfAborted();
      const event = queue.shift();
      if (!event) continue;
      if (event.type === 'error') {
        if (
          ['unexpected-eof', 'truncated-event', 'incomplete', 'event-too-large'].includes(
            event.reason || '',
          )
        )
          throw new IncompleteGeneration(event.reason!, event.message);
        throw new Error(event.message);
      }
      if (event.type === 'result' || event.type === 'complete') ended = true;
      yield event;
    }
  } finally {
    ended = true;
    signal?.removeEventListener('abort', abort);
    port.disconnect();
  }
}
export async function planCall<T extends PlanControlRequest>(
  request: T,
  signal?: AbortSignal,
): Promise<PlanResult<T>> {
  for await (const event of planEvents(request, signal)) {
    if (event.type === 'result') {
      validatePlanResult(request, event);
      return event;
    }
  }
  throw new Error('ChatGPT helper returned no result.');
}
