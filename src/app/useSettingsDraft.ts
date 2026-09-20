import { useEffect, useRef, useState } from 'react';
import { getSettings, saveSettings, DEFAULT_SETTINGS } from '../storage/settings';
import type { UserSettings, ProviderProfile } from '../types';
export function validateProvider(settings: UserSettings) {
  if (settings.activeProvider === 'chrome-ai') return;
  let url: URL;
  try {
    url = new URL(settings.openaiCompatible.baseUrl);
  } catch {
    throw new Error('Enter a valid model endpoint URL.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      'Use an HTTP(S) endpoint without credentials, query parameters, or a fragment.',
    );
  if (!settings.openaiCompatible.model.trim())
    throw new Error('Enter a model name available from this provider.');
}
export function useSettingsDraft(onSaved?: () => void, onDirty?: (dirty: boolean) => void) {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false),
    [dirty, setDirty] = useState(false),
    [saved, setSaved] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const savingRef = useRef(false);
  useEffect(() => {
    let active = true;
    getSettings()
      .then((s) => {
        if (!active) return;
        const id = s.activeProfileId || 'default';
        setSettings({
          ...s,
          activeProfileId: id,
          profiles: s.profiles?.length
            ? s.profiles
            : [{ id, name: 'Default', config: s.openaiCompatible }],
        });
        setLoaded(true);
      })
      .catch((e) => {
        if (active) setError(e.message);
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
      validateProvider(settings);
      const next = { ...settings, profiles: profilesWithCurrent() };
      await saveSettings(next);
      setSettings(next);
      setDirty(false);
      setSaved(true);
      onSaved?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  return { settings, loaded, dirty, saved, saving, error, update, profilesWithCurrent, save };
}
