import type { SettingsRequest, SettingsState } from '../contracts/settings';
import type { Reply } from '../types/storage';

export class SettingsDeliveryError extends Error {
  constructor(mutating: boolean, options?: ErrorOptions) {
    super(
      mutating
        ? 'The save outcome is unknown. Your draft is still here. Reload saved settings before saving again.'
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
    reply = await chrome.runtime.sendMessage({ target: 'saul-settings', message });
  } catch (cause) {
    throw new SettingsDeliveryError(message.action !== 'read', { cause });
  }
  if (!reply) throw new SettingsDeliveryError(message.action !== 'read');
  if (!reply.success) throw new Error(reply.error);
  return reply.result;
}
