import type { Configuration } from './definition';
import { validateSettingsRequest, type SettingsState } from '../settings/contract';
import { InvalidStoredSettingsError, decodeConfiguration, settingsFromStored } from './record';
import { DEFAULT_CONFIGURATION } from './definition';
import { validateSettingsConnections } from './resolve';

export const SETTINGS_STORAGE_KEY = 'saul_user_settings';
export const RECOVERY_BACKUP_KEY = 'saul_user_settings_recovery_backup';

export interface SharedConfigurationAccess {
  load(settings: Configuration): Promise<Configuration>;
  save(settings: Configuration): Promise<Configuration>;
}
export interface CredentialAccess {
  prepare(settings: Configuration, current: Configuration): Promise<Configuration>;
}

async function revisionOf(stored: unknown): Promise<string> {
  // Hash the raw record, including unknown fields, without exposing credentials
  // in a revision or rewriting legacy records merely because they were read.
  // Chrome may reorder object keys on storage round trips; array order matters.
  const serialized = JSON.stringify(stored, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : value,
  );
  const bytes = new TextEncoder().encode(serialized ?? 'absent');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface ConfigurationStorage {
  /** Return a detached raw record, or undefined for a new installation. */
  read(): Promise<unknown>;
  /** Apply all keys together, including the invalid-record backup during reset. */
  write(values: Record<string, unknown>): Promise<void>;
}

/** One background instance serializes editor reads, commits and recovery.
 * Rejected operations do not poison the lane. Shared and credential effects are
 * not replayed after an uncertain write; callers must read a fresh revision.
 */
export function createConfigurationStore(
  storage: ConfigurationStorage,
  shared?: SharedConfigurationAccess,
  credentials?: CredentialAccess,
): (request: unknown) => Promise<SettingsState> {
  let pending: Promise<unknown> = Promise.resolve();
  return (value) => {
    // Freeze direct callers too; Chrome messages already arrive as copies.
    const request: unknown = structuredClone(value);
    const result = pending.then(async (): Promise<SettingsState> => {
      validateSettingsRequest(request);
      const stored = await storage.read();
      let loaded: Configuration | undefined;
      try {
        loaded = settingsFromStored(stored);
        if (shared) loaded = await shared.load(loaded);
      } catch (error) {
        if (!(error instanceof InvalidStoredSettingsError)) throw error;
      }
      // Initial shared adoption: retain remapped action IDs and migration revisions.
      if (
        request.action === 'read' &&
        shared &&
        loaded &&
        ((loaded.sharedPresetRevision !== undefined &&
          settingsFromStored(stored).sharedPresetRevision === undefined) ||
          (loaded.scopedConfigRevision !== undefined &&
            settingsFromStored(stored).scopedConfigRevision === undefined))
      ) {
        await storage.write({ [SETTINGS_STORAGE_KEY]: loaded });
        return {
          state: 'ready',
          settings: loaded,
          revision: await revisionOf({
            stored: loaded,
            sharedRevision: loaded.sharedPresetRevision,
            scopedRevision: loaded.scopedConfigRevision,
          }),
        };
      }
      const revision = await revisionOf(
        shared
          ? {
              stored,
              sharedRevision: loaded?.sharedPresetRevision,
              scopedRevision: loaded?.scopedConfigRevision,
            }
          : stored,
      );
      if (request.action !== 'read' && request.baseline !== revision)
        return {
          state: 'conflict',
          error:
            'Settings changed in another surface. Your draft is still here. Review latest settings to keep your edits, or reload to discard them.',
        };

      if (request.action === 'commit') {
        settingsFromStored(stored); // Invalid originals require explicit backed-up recovery.
        // Normalize and validate in the write owner, not only in the form.
        // The revision token names the loaded state. A draft cannot pick a
        // different shared revision or bypass the shared commit by omitting it.
        let settings = decodeConfiguration(
          Object.assign({}, request.settings, {
            sharedPresetRevision: loaded?.sharedPresetRevision,
            scopedConfigRevision: loaded?.scopedConfigRevision,
          }),
        );
        validateSettingsConnections(settings);
        if (credentials)
          settings = await credentials.prepare(settings, loaded ?? settingsFromStored(stored));
        if (shared) settings = await shared.save(settings);
        try {
          await storage.write({ [SETTINGS_STORAGE_KEY]: settings });
        } catch (cause) {
          if (!shared) throw cause;
          throw new Error(
            'Settings could not be saved locally. Shared configuration may already be saved; reload saved settings before saving again.',
            { cause },
          );
        }
        return {
          state: 'ready',
          settings,
          revision: await revisionOf(
            shared
              ? {
                  stored: settings,
                  sharedRevision: settings.sharedPresetRevision,
                  scopedRevision: settings.scopedConfigRevision,
                }
              : settings,
          ),
        };
      }

      try {
        return {
          state: 'ready',
          revision,
          settings: loaded ?? settingsFromStored(stored),
          ...(request.action === 'reset' ? { reset: false } : {}),
        };
      } catch (error) {
        if (!(error instanceof InvalidStoredSettingsError)) throw error;
        if (request.action === 'read') return { state: 'invalid', revision, error: error.message };
      }
      let settings = structuredClone(DEFAULT_CONFIGURATION);
      if (
        stored &&
        typeof stored === 'object' &&
        'sharedCredentials' in stored &&
        ['saul', 'disconnected'].includes(String(stored.sharedCredentials))
      )
        settings.sharedCredentials = 'disconnected';
      if (shared) settings = await shared.load(settings);
      try {
        await storage.write({
          [RECOVERY_BACKUP_KEY]: stored,
          [SETTINGS_STORAGE_KEY]: settings,
        });
      } catch (cause) {
        throw new Error('Could not back up and reset saved settings. Try again.', { cause });
      }
      return {
        state: 'ready',
        revision: await revisionOf(
          shared
            ? {
                stored: settings,
                sharedRevision: settings.sharedPresetRevision,
                scopedRevision: settings.scopedConfigRevision,
              }
            : settings,
        ),
        settings,
        reset: true,
      };
    });
    pending = result.catch(() => {});
    return result;
  };
}
