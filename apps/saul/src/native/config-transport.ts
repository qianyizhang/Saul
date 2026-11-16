import {
  PLAN_HOST,
  validatePlanResult,
  type PlanControlRequest,
} from '../../native/plan-protocol.mts';
import {
  validateScopedConfigValue,
  type SharedPresets,
  type ScopedConfig,
} from '../../native/shared-presets-contract.mts';

type Request = Extract<PlanControlRequest, { action: 'config-read' | 'config-save' }>;
export class ConfigUnavailableError extends Error {}
export async function scopedCall(request: Request): Promise<ScopedConfig> {
  if (request.action === 'config-save') validateScopedConfigValue(request.value);
  let reply;
  try {
    reply = await chrome.runtime.sendNativeMessage(PLAN_HOST, { id: crypto.randomUUID(), request });
  } catch (cause) {
    throw new ConfigUnavailableError('Unified config helper unavailable.', { cause });
  }
  if (reply?.event?.type === 'error') throw new Error(reply.event.message);
  validatePlanResult(request, reply?.event);
  return reply.event.config;
}

type PresetRequest = Extract<
  PlanControlRequest,
  { action: 'presets-read' | 'presets-import' | 'presets-save' }
>;
export async function sharedCall(request: PresetRequest): Promise<SharedPresets> {
  const reply = await chrome.runtime.sendNativeMessage(PLAN_HOST, {
    id: crypto.randomUUID(),
    request,
  });
  if (reply?.event?.type === 'error') throw new Error(reply.event.message);
  validatePlanResult(request, reply?.event);
  return reply.event.library;
}

export async function commitSharedConfiguration(
  request: Extract<PlanControlRequest, { action: 'config-commit' }>,
) {
  const reply = await chrome.runtime.sendNativeMessage(PLAN_HOST, {
    id: crypto.randomUUID(),
    request,
  });
  if (reply?.event?.type === 'error') throw new Error(reply.event.message);
  validatePlanResult(request, reply?.event);
  return { library: reply.event.library, config: reply.event.config };
}
