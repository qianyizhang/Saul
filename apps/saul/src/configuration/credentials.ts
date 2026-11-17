import type { CredentialAccess } from './store';
import { nativeCredentialCall } from '../native/credentials';

export const nativeCredentialAccess: CredentialAccess = {
  async prepare(settings, current) {
    if (settings.sharedCredentials === 'saul' && current.sharedCredentials !== 'saul') {
      // Verify the signed owner before persisting the opt-in. No key or plan
      // account is imported, erased, selected or rebound during this change.
      await nativeCredentialCall({ action: 'status' });
    }
    return settings;
  },
};
