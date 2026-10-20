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
import {
  configurationFor,
  presetFromSettings,
  settingsForPreset,
  validateConfiguration,
} from '../models/configuration';

function settingsDraft(settings: UserSettings): UserSettings {
  const activeProfileId = settings.activeProfileId || 'default';
  const normalized = {
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
  const configuration = configurationFor(settings);
  const recipe = configuration.recipes.find((item) => item.id === configuration.selectedRecipeId)!;
  const preset = configuration.presets.find((item) => item.id === recipe.presetId)!;
  return { ...settingsForPreset(normalized, preset, true), configuration };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Settings could not be loaded.';
}

export function useSettingsDraft(onDirty?: (dirty: boolean) => void) {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [selectedPresetId, setSelectedPresetId] = useState('preset-current');
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
        const next = settingsDraft(s);
        setSettings(next);
        const configuration = configurationFor(next);
        setSelectedPresetId(
          configuration.recipes.find((recipe) => recipe.id === configuration.selectedRecipeId)!
            .presetId,
        );
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
    setSettings((s) => {
      const next = { ...s, ...patch };
      const configuration = configurationFor(next);
      const selected = configuration.presets.find((preset) => preset.id === selectedPresetId);
      return {
        ...next,
        configuration: selected
          ? {
              ...configuration,
              presets: configuration.presets.map((preset) =>
                preset.id === selected.id
                  ? presetFromSettings(next, selected.id, selected.name)
                  : preset,
              ),
            }
          : configuration,
      };
    });
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
  function selectPreset(id: string) {
    const preset = configurationFor(settings).presets.find((item) => item.id === id);
    if (!preset || savingRef.current) return;
    setSettings(settingsForPreset({ ...settings, profiles: profilesWithCurrent() }, preset, true));
    setSelectedPresetId(id);
    setError('');
    setSaved(false);
  }
  function addPreset() {
    if (savingRef.current) return;
    const configuration = configurationFor(settings);
    const id = crypto.randomUUID();
    let name = 'New preset';
    for (
      let suffix = 2;
      configuration.presets.some((preset) => preset.name.toLowerCase() === name.toLowerCase());
      suffix++
    )
      name = `New preset ${suffix}`;
    setSettings({
      ...settings,
      configuration: {
        ...configuration,
        presets: [...configuration.presets, presetFromSettings(settings, id, name)],
      },
    });
    setSelectedPresetId(id);
    setDirty(true);
    setSaved(false);
    setError('');
  }
  function removePreset() {
    if (savingRef.current) return;
    const configuration = configurationFor(settings);
    const used = configuration.recipes.filter((recipe) => recipe.presetId === selectedPresetId);
    if (used.length) {
      setError(
        `This preset is used by ${used.map((recipe) => recipe.name).join(', ')}. Choose another default preset for those recipes first.`,
      );
      return;
    }
    const presets = configuration.presets.filter((preset) => preset.id !== selectedPresetId);
    if (!presets.length) {
      setError('Keep at least one preset.');
      return;
    }
    const next = {
      ...settings,
      profiles: profilesWithCurrent(),
      configuration: { ...configuration, presets },
    };
    setSettings(settingsForPreset(next, presets[0]!, true));
    setSelectedPresetId(presets[0]!.id);
    setDirty(true);
    setSaved(false);
    setError('');
  }
  async function save() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      validateConfiguration(configurationFor(settings));
      validateProviderSettings(settings);
      const next = { ...settings, profiles: profilesWithCurrent() };
      await saveSettings(next);
      setSettings(next);
      setDirty(false);
      setSaved(true);
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
      const configuration = configurationFor(recovered.settings);
      setSelectedPresetId(
        configuration.recipes.find((recipe) => recipe.id === configuration.selectedRecipeId)!
          .presetId,
      );
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
    selectedPresetId,
    selectPreset,
    addPreset,
    removePreset,
    save,
    resetInvalidSettings,
  };
}
