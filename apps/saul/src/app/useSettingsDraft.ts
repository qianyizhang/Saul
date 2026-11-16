import { useEffect, useRef, useState } from 'react';
import type { SettingsState } from '../contracts/settings';
import {
  createSettingsDraft,
  editSettingsDraft,
  settingsForSave,
  settingsFromDraft,
  settingsForInspection,
  type SettingsEdit,
} from '../models/settings-draft';
import { DEFAULT_SETTINGS } from '../storage/settings';
import {
  reviewSettings,
  type RecoveryChoice,
  type SettingsReview,
} from '../models/settings-recovery';
import { requestSettings, SettingsDeliveryError } from '../storage/settings-client';
import type { ConnectionDefinition } from '../../native/shared-presets-contract.mts';

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Settings could not be loaded.';

export function useSettingsDraft(onDirty?: (dirty: boolean) => void) {
  const [form, setForm] = useState(() => createSettingsDraft(DEFAULT_SETTINGS));
  const formRef = useRef(form);
  const baseline = useRef<string | undefined>(undefined);
  const loadedDraft = useRef<typeof form | undefined>(undefined);
  const [review, setReview] = useState<{
    plan: SettingsReview;
    latest: SettingsState & { state: 'ready' };
  }>();
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

  function markDirty(value: boolean) {
    // Navigation can follow the input event before React effects run.
    setDirty(value);
    onDirty?.(value);
  }

  function replaceForm(next: typeof form) {
    formRef.current = next;
    setForm(next);
  }
  function receiveLoaded(result: SettingsState, preserveSelection = false) {
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
      markDirty(false);
      setSaved(false);
      return;
    }
    const next = createSettingsDraft(
      result.settings,
      preserveSelection ? formRef.current : undefined,
    );
    replaceForm(next);
    loadedDraft.current = structuredClone(next);
    setReview(undefined);
    setLoaded(true);
    markDirty(false);
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
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    if (dirty) window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function edit(action: SettingsEdit) {
    if (running.current) return;
    try {
      replaceForm(editSettingsDraft(formRef.current, action));
      if (action.type !== 'select-preset' && action.type !== 'select-recipe') markDirty(true);
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
    setRecoveryNotice('');
    let submitted = false;
    try {
      const settings = settingsForSave(formRef.current);
      submitted = true;
      const result = await requestSettings({
        action: 'commit',
        baseline: baseline.current,
        settings,
      });
      if (!mounted.current) return;
      if (result.state !== 'ready') {
        setError(result.error);
        setBlocked(true);
        return;
      }
      baseline.current = result.revision;
      const next = createSettingsDraft(result.settings, formRef.current);
      replaceForm(next);
      loadedDraft.current = structuredClone(next);
      markDirty(false);
      setSaved(true);
    } catch (cause) {
      if (!mounted.current) return;
      setError(message(cause));
      if (submitted) setBlocked(true);
    } finally {
      running.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  async function reviewLatest() {
    if (running.current || !loadedDraft.current) return;
    running.current = true;
    setSaving(true);
    setError('');
    try {
      const latest = await requestSettings({ action: 'read' });
      if (!mounted.current) return;
      if (latest.state !== 'ready') throw new Error(latest.error);
      setReview({
        plan: reviewSettings(loadedDraft.current, formRef.current, latest.settings),
        latest,
      });
    } catch (cause) {
      if (mounted.current) setError(`${message(cause)} Your draft is still here.`);
    } finally {
      running.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  function applyReview(choices: Record<string, RecoveryChoice | undefined>) {
    if (!review || running.current) return;
    try {
      const result = review.plan.apply(choices);
      baseline.current = review.latest.revision;
      loadedDraft.current = createSettingsDraft(review.latest.settings);
      replaceForm(result.draft);
      markDirty(result.dirty);
      setBlocked(false);
      setSaved(false);
      setError('');
      setReview(undefined);
      setRecoveryNotice(
        result.dirty
          ? 'Reviewed edits are in your draft. Save to apply them.'
          : 'Your edits already match the saved settings.',
      );
    } catch (cause) {
      setError(message(cause));
    }
  }
  function cancelReview() {
    setReview(undefined);
    setError('Your draft is still here. Review latest settings before saving again.');
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
  async function setCredentialOwner(owner: 'saul' | 'disconnected') {
    if (running.current || dirty || blocked || !baseline.current) return;
    running.current = true;
    setSaving(true);
    setError('');
    try {
      const result = await requestSettings({
        action: 'commit',
        baseline: baseline.current,
        settings: { ...settingsForSave(formRef.current), sharedCredentials: owner },
      });
      if (mounted.current) receiveLoaded(result, true);
    } catch (cause) {
      if (mounted.current) {
        setError(message(cause));
        setBlocked(true);
      }
    } finally {
      running.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  async function commitConnections(connections: ConnectionDefinition[]) {
    if (running.current || dirty || blocked || !baseline.current)
      throw new Error('Save or reload the current settings draft before changing connections.');
    running.current = true;
    setSaving(true);
    try {
      const result = await requestSettings({
        action: 'commit',
        baseline: baseline.current,
        settings: { ...settingsForSave(formRef.current), connections },
      });
      if (!mounted.current) return;
      if (result.state !== 'ready') {
        setBlocked(true);
        throw new Error(result.error);
      }
      receiveLoaded(result, true);
    } catch (cause) {
      if (cause instanceof SettingsDeliveryError) setBlocked(true);
      throw cause;
    } finally {
      running.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  return {
    settings: settingsFromDraft(form),
    inspectedSettings: settingsForInspection(form),
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
    review: review?.plan,
    reviewLatest,
    applyReview,
    cancelReview,
    edit,
    save,
    reload,
    resetInvalidSettings,
    setCredentialOwner,
    commitConnections,
  };
}
