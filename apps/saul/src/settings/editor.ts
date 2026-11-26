import type { SettingsRequest, SettingsState } from './contract';
import { DEFAULT_CONFIGURATION } from '../configuration/definition';
import {
  createSettingsDraft,
  editSettingsDraft,
  settingsForSave,
  settingsFromDraft,
  inspectDraftPreset,
  type SettingsEdit,
} from './draft';
import { draftInspectionSettings, type SettingsValues } from './draft-storage';
import { reviewSettings, type RecoveryChoice, type SettingsReview } from './recovery';
import type { ConnectionSetup } from '../connections/setup';
import { saveSetup } from '../connections/client';
import { changeConnection, type ConnectionChange } from './connection-management';

type Ready = Extract<SettingsState, { state: 'ready' }>;
type Operation = 'save' | 'review' | 'reload' | 'reset' | 'connections' | 'credentials';
type Phase = 'loading' | 'unavailable' | 'invalid' | 'editing';
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Settings could not be loaded.';

/** One surface's editing lifetime. Transport revisions and draft recovery never escape it. */
export function createSettingsEditor(
  request: (request: SettingsRequest) => Promise<SettingsState>,
) {
  let form = createSettingsDraft(DEFAULT_CONFIGURATION);
  let baseline: string | undefined;
  let loadedDraft: typeof form | undefined;
  let review: { plan: SettingsReview; latest: Ready } | undefined;
  let phase: Phase = 'loading';
  let operation: Operation | undefined;
  let dirty = false,
    needsReview = false,
    saved = false;
  let error = '',
    recoveryNotice = '';
  let generation = 0;
  const listeners = new Set<() => void>();
  const view = () => {
    const configuration = structuredClone(draftInspectionSettings(form));
    const selectedPreset = structuredClone(
      form.values.configuration.presets.find((p) => p.id === form.presetId),
    );
    const inspection = inspectDraftPreset(form);
    return {
      phase,
      operation,
      configuration,
      selectedPreset,
      inspection,
      selectedPresetId: form.presetId,
      selectedRecipeId: form.recipeId,
      loaded: phase === 'editing',
      dirty,
      saved,
      saving: operation !== undefined && operation !== 'reset',
      blocked: needsReview,
      error,
      canResetInvalidSettings: phase === 'invalid',
      resettingInvalidSettings: operation === 'reset',
      recoveryNotice,
      review: review ? { changes: structuredClone(review.plan.changes) } : undefined,
    };
  };
  let snapshot = view();
  function publish() {
    snapshot = view();
    for (const listener of listeners) listener();
  }
  function receive(result: SettingsState, preserveSelection = false) {
    if (result.state === 'conflict') {
      error = result.error;
      needsReview = true;
      return;
    }
    baseline = result.revision;
    needsReview = false;
    if (result.state === 'invalid') {
      phase = 'invalid';
      error = result.error;
      dirty = false;
      saved = false;
      review = undefined;
      return;
    }
    form = createSettingsDraft(result.settings, preserveSelection ? form : undefined);
    loadedDraft = structuredClone(form);
    review = undefined;
    phase = 'editing';
    dirty = false;
    saved = false;
    error = '';
  }
  function begin(next: Operation) {
    if (operation) return undefined;
    operation = next;
    error = '';
    publish();
    return generation;
  }
  function finish(token: number) {
    if (token === generation) {
      operation = undefined;
      publish();
    }
  }
  function editable() {
    return phase === 'editing' && !operation && !review;
  }
  async function guardedCommit(
    update: (values: SettingsValues) => SettingsValues,
    kind: 'credentials' | 'connections',
  ) {
    if (!editable() || dirty || needsReview || !baseline) {
      if (kind === 'connections')
        throw new Error('Save or reload the current settings draft before changing connections.');
      return;
    }
    const token = begin(kind)!;
    let submitted = false;
    try {
      const settings = settingsForSave({ ...form, values: update(form.values) });
      submitted = true;
      const result = await request({
        action: 'commit',
        baseline,
        settings,
      });
      if (token !== generation) return;
      if (result.state !== 'ready') {
        needsReview = true;
        throw new Error(result.error);
      }
      receive(result, true);
    } catch (cause) {
      if (token !== generation) return;
      if (submitted) needsReview = true;
      if (kind === 'connections') throw cause;
      error = message(cause);
    } finally {
      finish(token);
    }
  }
  return {
    getSnapshot: () => snapshot,
    configurationForProviderTest: () => structuredClone(settingsFromDraft(form)),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async open() {
      const token = ++generation;
      phase = 'loading';
      operation = undefined;
      publish();
      try {
        const result = await request({ action: 'read' });
        if (token === generation) receive(result);
      } catch (cause) {
        if (token === generation) {
          phase = 'unavailable';
          error = message(cause);
        }
      } finally {
        if (token === generation) publish();
      }
    },
    close() {
      generation++;
      operation = undefined;
    },
    edit(action: SettingsEdit) {
      if (!editable()) return;
      try {
        form = editSettingsDraft(form, action);
        if (action.type !== 'select-preset' && action.type !== 'select-recipe') dirty = true;
        saved = false;
        if (!needsReview) error = '';
        recoveryNotice = '';
      } catch (cause) {
        error = message(cause);
      }
      publish();
    },
    async save() {
      if (!editable() || needsReview || !baseline) return;
      const token = begin('save')!;
      recoveryNotice = '';
      let submitted = false;
      try {
        const settings = settingsForSave(form);
        submitted = true;
        const result = await request({ action: 'commit', baseline, settings });
        if (token !== generation) return;
        if (result.state !== 'ready') {
          error = result.error;
          needsReview = true;
          return;
        }
        receive(result, true);
        saved = true;
      } catch (cause) {
        if (token !== generation) return;
        error = message(cause);
        if (submitted) needsReview = true;
      } finally {
        finish(token);
      }
    },
    async reviewLatest() {
      if (!editable() || !loadedDraft) return;
      const token = begin('review')!;
      try {
        const latest = await request({ action: 'read' });
        if (token !== generation) return;
        if (latest.state !== 'ready') throw new Error(latest.error);
        review = { plan: reviewSettings(loadedDraft, form, latest.settings), latest };
      } catch (cause) {
        if (token === generation) error = `${message(cause)} Your draft is still here.`;
      } finally {
        finish(token);
      }
    },
    applyReview(choices: Record<string, RecoveryChoice | undefined>) {
      if (!review || operation) return;
      try {
        const result = review.plan.apply(choices);
        baseline = review.latest.revision;
        loadedDraft = createSettingsDraft(review.latest.settings);
        form = result.draft;
        dirty = result.dirty;
        needsReview = false;
        saved = false;
        error = '';
        review = undefined;
        recoveryNotice = dirty
          ? 'Reviewed edits are in your draft. Save to apply them.'
          : 'Your edits already match the saved settings.';
      } catch (cause) {
        error = message(cause);
      }
      publish();
    },
    cancelReview() {
      if (operation) return;
      review = undefined;
      error = 'Your draft is still here. Review latest settings before saving again.';
      publish();
    },
    /** The surface confirms discard before calling this operation. */
    async reload() {
      const token = begin('reload');
      if (token === undefined) return;
      try {
        const result = await request({ action: 'read' });
        if (token === generation) {
          receive(result);
          recoveryNotice = '';
        }
      } catch (cause) {
        if (token === generation) error = message(cause);
      } finally {
        finish(token);
      }
    },
    async resetInvalidSettings() {
      if (phase !== 'invalid' || operation || needsReview || !baseline) return;
      const token = begin('reset')!;
      try {
        const result = await request({ action: 'reset', baseline });
        if (token !== generation) return;
        receive(result);
        if (result.state === 'ready')
          recoveryNotice = result.reset
            ? 'Defaults restored. The previous saved settings remain in a local recovery backup.'
            : 'Saved settings changed and now load without a reset.';
      } catch (cause) {
        if (token === generation) {
          error = message(cause);
          needsReview = true;
        }
      } finally {
        finish(token);
      }
    },
    setCredentialOwner: (sharedCredentials: 'saul' | 'disconnected') =>
      guardedCommit((settings) => ({ ...settings, sharedCredentials }), 'credentials'),
    async finishConnection(setup: ConnectionSetup, key: string, resume: boolean) {
      if (!editable() || dirty || !baseline)
        throw new Error('Save the current settings draft first.');
      const token = begin('connections')!;
      try {
        const result = await saveSetup(setup, key, resume);
        if (token === generation) receive(result, true);
      } finally {
        finish(token);
      }
    },
    manageConnection: (change: ConnectionChange) =>
      guardedCommit((settings) => changeConnection(settings, change), 'connections'),
  };
}
