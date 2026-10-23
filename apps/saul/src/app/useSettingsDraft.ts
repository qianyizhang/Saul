import { useEffect, useRef, useState } from 'react';
import type { SettingsState } from '../contracts/settings';
import {
  createSettingsDraft,
  editSettingsDraft,
  settingsForSave,
  type SettingsEdit,
} from '../models/settings-draft';
import { DEFAULT_SETTINGS } from '../storage/settings';
import { requestSettings, SettingsDeliveryError } from '../storage/settings-client';

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Settings could not be loaded.';

export function useSettingsDraft(onDirty?: (dirty: boolean) => void) {
  const [form, setForm] = useState(() => createSettingsDraft(DEFAULT_SETTINGS));
  const formRef = useRef(form);
  const baseline = useRef<string | undefined>(undefined);
  const running = useRef(false);
  const mounted = useRef(true);
  const [loaded, setLoaded] = useState(false),
    [dirty, setDirty] = useState(false),
    [saved, setSaved] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [blocked, setBlocked] = useState(false),
    [canResetInvalidSettings, setCanResetInvalidSettings] = useState(false),
    [resettingInvalidSettings, setResettingInvalidSettings] = useState(false),
    [recoveryNotice, setRecoveryNotice] = useState('');

  function replaceForm(next: typeof form) {
    formRef.current = next;
    setForm(next);
  }
  function receiveLoaded(result: SettingsState) {
    if (result.state === 'conflict') {
      setError(result.error);
      setBlocked(true);
      return;
    }
    baseline.current = result.revision;
    setBlocked(false);
    if (result.state === 'invalid') {
      setError(result.error);
      setCanResetInvalidSettings(true);
      setLoaded(false);
      setDirty(false);
      setSaved(false);
      return;
    }
    replaceForm(createSettingsDraft(result.settings));
    setLoaded(true);
    setDirty(false);
    setSaved(false);
    setBlocked(false);
    setError('');
    setCanResetInvalidSettings(false);
  }

  useEffect(() => {
    let active = true;
    mounted.current = true;
    requestSettings({ action: 'read' }).then(
      (result) => {
        if (active) receiveLoaded(result);
      },
      (cause) => {
        if (active) setError(message(cause));
      },
    );
    return () => {
      active = false;
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    onDirty?.(dirty);
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    if (dirty) window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, onDirty]);

  function edit(action: SettingsEdit) {
    if (running.current) return;
    try {
      replaceForm(editSettingsDraft(formRef.current, action));
      if (action.type !== 'select-preset' && action.type !== 'select-recipe') setDirty(true);
      setSaved(false);
      if (!blocked) setError('');
      setRecoveryNotice('');
    } catch (cause) {
      setError(message(cause));
    }
  }
  async function save() {
    if (running.current || blocked || !baseline.current) return;
    running.current = true;
    setSaving(true);
    setError('');
    try {
      const result = await requestSettings({
        action: 'commit',
        baseline: baseline.current,
        settings: settingsForSave(formRef.current),
      });
      if (!mounted.current) return;
      if (result.state !== 'ready') {
        setError(result.error);
        setBlocked(true);
        return;
      }
      baseline.current = result.revision;
      replaceForm({ ...formRef.current, settings: result.settings });
      setDirty(false);
      setSaved(true);
    } catch (cause) {
      if (!mounted.current) return;
      setError(message(cause));
      if (cause instanceof SettingsDeliveryError) setBlocked(true);
    } finally {
      running.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  async function reload() {
    if (running.current) return;
    if (dirty && !window.confirm('Discard your draft and reload the latest saved settings?'))
      return;
    running.current = true;
    setSaving(true);
    try {
      const result = await requestSettings({ action: 'read' });
      if (mounted.current) {
        receiveLoaded(result);
        setRecoveryNotice('');
      }
    } catch (cause) {
      if (mounted.current) setError(message(cause));
    } finally {
      running.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  async function resetInvalidSettings() {
    if (!canResetInvalidSettings || running.current || blocked || !baseline.current) return;
    running.current = true;
    setResettingInvalidSettings(true);
    try {
      const result = await requestSettings({ action: 'reset', baseline: baseline.current });
      if (!mounted.current) return;
      receiveLoaded(result);
      if (result.state === 'ready')
        setRecoveryNotice(
          result.reset
            ? 'Defaults restored. The previous saved settings remain in a local recovery backup.'
            : 'Saved settings changed and now load without a reset.',
        );
    } catch (cause) {
      if (mounted.current) {
        setError(message(cause));
        if (cause instanceof SettingsDeliveryError) setBlocked(true);
      }
    } finally {
      running.current = false;
      if (mounted.current) setResettingInvalidSettings(false);
    }
  }
  return {
    settings: form.settings,
    selectedPresetId: form.presetId,
    selectedRecipeId: form.recipeId,
    loaded,
    dirty,
    saved,
    saving,
    error,
    blocked,
    canResetInvalidSettings,
    resettingInvalidSettings,
    recoveryNotice,
    edit,
    save,
    reload,
    resetInvalidSettings,
  };
}
