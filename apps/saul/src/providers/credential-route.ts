import { CREDENTIAL_MODE_TARGET } from '../native/control-messages';
import { SETTINGS_STORAGE_KEY } from '../configuration/store';
export type CredentialRoute = 'local' | 'saul' | 'disconnected';

/** Read only the live routing decision. Never upgrade or write configuration during inference. */
export async function readCredentialRoute(): Promise<CredentialRoute> {
  if (chrome.storage?.local) {
    const record: unknown = (await chrome.storage.local.get(SETTINGS_STORAGE_KEY))[
      SETTINGS_STORAGE_KEY
    ];
    if (record === undefined) return 'local';
    if (!record || typeof record !== 'object' || Array.isArray(record))
      throw new Error('Cannot resolve the saved Saul credential route. Retry explicitly.');
    const mode = 'sharedCredentials' in record ? record.sharedCredentials : undefined;
    if (mode === undefined) return 'local';
    if (mode === 'saul' || mode === 'disconnected') return mode;
  } else {
    const reply: unknown = await chrome.runtime.sendMessage({ target: CREDENTIAL_MODE_TARGET });
    if (
      reply &&
      typeof reply === 'object' &&
      'success' in reply &&
      reply.success === true &&
      'result' in reply &&
      reply.result &&
      typeof reply.result === 'object' &&
      'mode' in reply.result
    ) {
      const mode = reply.result.mode;
      if (mode === 'standalone') return 'local';
      if (mode === 'saul' || mode === 'disconnected') return mode;
    }
  }
  throw new Error('Cannot resolve the saved Saul credential route. Retry explicitly.');
}
