import {
  PLAN_PORT,
  validatePlanResult,
  type PlanRequest,
  type PlanEvent,
  type PlanControlRequest,
  type PlanResult,
} from '../../native/plan-protocol.mts';
import { IncompleteGeneration } from './events';
import { isCredentialPlan } from '../../native/credentials-contract.mts';
import { credentialEvents } from '../native/credentials';
import { getSettings } from '../storage/settings';

export class HistoryDisconnected extends Error {}

export async function* planEvents(
  request: PlanRequest,
  signal?: AbortSignal,
): AsyncGenerator<PlanEvent> {
  signal?.throwIfAborted();
  if (isCredentialPlan(request)) {
    let mode: string | undefined;
    if (chrome.storage?.local) mode = (await getSettings()).sharedCredentials;
    else {
      const reply: unknown = await chrome.runtime.sendMessage({ target: 'saul-credential-mode' });
      if (
        !reply ||
        typeof reply !== 'object' ||
        !('success' in reply) ||
        reply.success !== true ||
        !('result' in reply) ||
        !reply.result ||
        typeof reply.result !== 'object' ||
        !('mode' in reply.result) ||
        !['saul', 'disconnected', 'standalone'].includes(String(reply.result.mode))
      )
        throw new Error('Cannot resolve the saved Saul credential route. Retry explicitly.');
      mode = String(reply.result.mode);
    }
    if (mode === 'disconnected')
      throw new Error('Connect this app to Saul credentials in Providers.');
    if (mode === 'saul') {
      for await (const event of credentialEvents(request, signal)) {
        if (event.type === 'authorize') continue;
        yield event as PlanEvent;
      }
      return;
    }
  }
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
      push({
        type: 'error',
        message: 'ChatGPT helper connection closed. Retry from Settings.',
        reason: 'bridge-lost',
      });
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
          request.action === 'history' &&
          ['bridge-lost', 'history-disconnected'].includes(event.reason || '')
        )
          throw new HistoryDisconnected(event.message);
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
