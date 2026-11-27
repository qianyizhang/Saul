import {
  SETTINGS_TARGET,
  type SettingsMessage,
  type SettingsRequest,
  type SettingsState,
} from '../settings/contract';
import type { Reply } from '../../shared/protocol/history-types.ts';

export class SettingsDeliveryError extends Error {
  constructor(mutating: boolean, options?: ErrorOptions) {
    super(
      mutating
        ? 'The save outcome is unknown. Your draft is still here. Review latest settings before saving again.'
        : 'Could not load settings. Reload Saul and try again.',
      options,
    );
    this.name = 'SettingsDeliveryError';
  }
}

/** UI adapter. All configuration writes are owned by the trusted background. */
export async function requestSettings(message: SettingsRequest): Promise<SettingsState> {
  let reply: Reply<SettingsState> | undefined;
  try {
    reply = await chrome.runtime.sendMessage({
      target: SETTINGS_TARGET,
      message,
    } satisfies SettingsMessage);
  } catch (cause) {
    throw new SettingsDeliveryError(message.action !== 'read', { cause });
  }
  if (!reply) throw new SettingsDeliveryError(message.action !== 'read');
  if (!reply.success) throw new Error(reply.error);
  return reply.result;
}
