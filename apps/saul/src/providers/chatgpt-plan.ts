import { readCredentialRoute } from './credential-route';
import {
  validatePlanResult,
  type PlanEvent,
  type PlanRequest,
  type PlanControlRequest,
  type PlanResult,
} from '../../shared/protocol/credential-plan.mts';
import { credentialEvents } from '../native/credentials';
import { SELECT_NEW_PRESET } from '../configuration/resolve';

export async function* planEvents(
  request: PlanRequest,
  signal?: AbortSignal,
  expectedOwner?: 'local' | 'saul',
): AsyncGenerator<PlanEvent> {
  signal?.throwIfAborted();
  const mode = await readCredentialRoute();
  if (expectedOwner === 'local') throw new Error(SELECT_NEW_PRESET);
  if (mode !== 'saul')
    throw new Error('Connect this app to the signed Saul helper to use ChatGPT.');
  for await (const event of credentialEvents(request, signal)) {
    if (event.type !== 'authorize') yield event as PlanEvent;
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
