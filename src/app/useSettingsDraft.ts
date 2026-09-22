import { useEffect, useRef, useState } from 'react';
import {
  backupAndResetInvalidSettings,
  getSettings,
  InvalidStoredSettingsError,
  saveSettings,
  DEFAULT_SETTINGS,
  validateProviderSettings,
} from '../storage/settings';
import type { UserSettings, ProviderProfile } from '../types';

function settingsDraft(settings: UserSettings): UserSettings {
  const activeProfileId = settings.activeProfileId || 'default';
  return {
    ...settings,
    activeProfileId,
    profiles: settings.profiles?.length
      ? settings.profiles
      : [
          {
            id: activeProfileId,
            name: 'Default',
            config: settings.openaiCompatible,
          },
        ],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Settings could not be loaded.';
}

export function useSettingsDraft(onSaved?: () => void, onDirty?: (dirty: boolean) => void) {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false),
    [dirty, setDirty] = useState(false),
    [saved, setSaved] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [canResetInvalidSettings, setCanResetInvalidSettings] = useState(false),
    [resettingInvalidSettings, setResettingInvalidSettings] = useState(false),
    [recoveryNotice, setRecoveryNotice] = useState('');
  const savingRef = useRef(false);
  useEffect(() => {
    let active = true;
    getSettings()
      .then((s) => {
        if (!active) return;
        setSettings(settingsDraft(s));
        setLoaded(true);
      })
      .catch((e) => {
        if (!active) return;
        setError(errorMessage(e));
        setCanResetInvalidSettings(e instanceof InvalidStoredSettingsError);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    onDirty?.(dirty);
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    if (dirty) window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, onDirty]);
  function update(patch: Partial<UserSettings>) {
    if (savingRef.current) return;
    setSettings((s) => ({ ...s, ...patch }));
    setDirty(true);
    setSaved(false);
    setError('');
    setRecoveryNotice('');
  }
  function profilesWithCurrent(): ProviderProfile[] {
    return (settings.profiles || []).map((p) =>
      p.id === settings.activeProfileId ? { ...p, config: settings.openaiCompatible } : p,
    );
  }
  async function save() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      validateProviderSettings(settings);
      const next = { ...settings, profiles: profilesWithCurrent() };
      await saveSettings(next);
      setSettings(next);
      setDirty(false);
      setSaved(true);
      onSaved?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  async function resetInvalidSettings() {
    if (!canResetInvalidSettings || resettingInvalidSettings) return;
    setResettingInvalidSettings(true);
    try {
      const recovered = await backupAndResetInvalidSettings();
      setError('');
      setSettings(settingsDraft(recovered.settings));
      setLoaded(true);
      setCanResetInvalidSettings(false);
      setDirty(false);
      setSaved(false);
      setRecoveryNotice(
        recovered.reset
          ? 'Defaults restored. The previous saved settings remain in a local recovery backup.'
          : 'Saved settings changed and now load without a reset.',
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setResettingInvalidSettings(false);
    }
  }
  return {
    settings,
    loaded,
    dirty,
    saved,
    saving,
    error,
    canResetInvalidSettings,
    resettingInvalidSettings,
    recoveryNotice,
    update,
    profilesWithCurrent,
    save,
    resetInvalidSettings,
  };
}
