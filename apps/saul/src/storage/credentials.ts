import type { UserSettings } from '../types';
import type { CredentialAccess } from './settings';
import { nativeCredentialCall } from '../native/credentials';
import { officialOpenAI } from '../../native/credentials-contract.mts';
export function sharedCredentialProjection(source: UserSettings): UserSettings {
  const settings = structuredClone(source);
  const mark = (connection: UserSettings['openaiCompatible']) => {
    if (officialOpenAI(connection.baseUrl)) {
      connection.apiKey = '';
      connection.credentialOwner = 'saul';
    }
  };
  mark(settings.openaiCompatible);
  for (const profile of settings.profiles ?? []) mark(profile.config);
  return settings;
}
export function stripOfficialKeys(value: unknown): unknown {
  const copy: unknown = structuredClone(value);
  if (!copy || typeof copy !== 'object' || Array.isArray(copy)) return copy;
  const strip = (connection: unknown) => {
    if (
      connection &&
      typeof connection === 'object' &&
      !Array.isArray(connection) &&
      'baseUrl' in connection &&
      typeof connection.baseUrl === 'string' &&
      officialOpenAI(connection.baseUrl) &&
      'apiKey' in connection
    )
      connection.apiKey = '';
  };
  if ('openaiCompatible' in copy) strip(copy.openaiCompatible);
  if ('profiles' in copy && Array.isArray(copy.profiles))
    for (const profile of copy.profiles)
      if (profile && typeof profile === 'object' && 'config' in profile) strip(profile.config);
  return copy;
}
export const nativeCredentialAccess: CredentialAccess = {
  async prepare(settings, current) {
    if (settings.sharedCredentials !== 'saul') {
      if (
        settings.sharedCredentials === 'disconnected' &&
        [settings.openaiCompatible, ...(settings.profiles ?? []).map((p) => p.config)].some(
          (c) => officialOpenAI(c.baseUrl) && c.apiKey.trim(),
        )
      )
        throw new Error('Connect this app to Saul before saving an official OpenAI API key.');
      return settings;
    }
    const adopting = current.sharedCredentials !== 'saul';
    if (adopting) {
      const status = await nativeCredentialCall({ action: 'status' });
      const selected = settings.connectionProfiles?.['openai-api'] || settings.activeProfileId;
      const profile = settings.profiles?.find((p) => p.id === selected);
      const source = profile?.config ?? settings.openaiCompatible;
      if (officialOpenAI(source.baseUrl) && source.apiKey.trim())
        await nativeCredentialCall({
          action: 'api-key-import',
          key: source.apiKey.trim(),
          selectedAccountId: settings.chatgptPlan?.accountId || undefined,
        });
      const accounts = Array.isArray(status.accounts) ? status.accounts : [];
      const savedID = settings.chatgptPlan?.accountId;
      const selectedID = accounts.some(
        (a) => a && typeof a === 'object' && 'id' in a && a.id === savedID,
      )
        ? savedID
        : typeof status.selectedAccountId === 'string'
          ? status.selectedAccountId
          : '';
      settings = {
        ...settings,
        chatgptPlan: { ...(settings.chatgptPlan ?? { model: '' }), accountId: selectedID || '' },
      };
    } else {
      const replacements = new Set(
        [
          ...(officialOpenAI(settings.openaiCompatible.baseUrl)
            ? [settings.openaiCompatible.apiKey.trim()]
            : []),
          ...(settings.profiles ?? [])
            .filter((p) => officialOpenAI(p.config.baseUrl))
            .map((p) => p.config.apiKey.trim()),
        ].filter(Boolean),
      );
      if (replacements.size > 1)
        throw new Error('Enter one replacement key for the shared OpenAI connection.');
      const replacement = [...replacements][0];
      if (replacement) await nativeCredentialCall({ action: 'api-key-save', key: replacement });
    }
    return sharedCredentialProjection(settings);
  },
  async committed(settings, current) {
    if (settings.sharedCredentials !== 'saul') return;
    const key = 'saul_user_settings_recovery_backup';
    const backup = await chrome.storage.local.get(key);
    if (backup[key] !== undefined)
      await chrome.storage.local.set({ [key]: stripOfficialKeys(backup[key]) });
    if (current.sharedCredentials !== 'saul') {
      try {
        await nativeCredentialCall({ action: 'migration-verified' });
      } catch {
        // The binding is already durable. Providers reads the owner's retirement
        // state and offers an explicit retry without reporting this save as failed.
      }
    }
  },
};
