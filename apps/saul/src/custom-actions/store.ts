import { scopedCall, ConfigUnavailableError } from '../native/config-transport';
import { isRecord as record } from '../../shared/model/value.mts';
import type { ActionChoice } from '../../shared/model/custom-action.ts';
import {
  deserializeChoices,
  legacyChoices,
  LEGACY_CHOICE_FIELDS,
  recoverChoices,
  serializeChoices,
  validatePart,
} from './choice-record';
import {
  LEGACY_CALL_STATE_KEY,
  type CallChoiceSource,
  type CallChoices,
  type CallEditorStorage,
  type SavedCallChoices,
  type SavedCallDraft,
} from './contract';

const CHOICES_KEY = 'saul_call_choices_v1';
const DRAFT_KEY = 'saul_call_draft_v1';
const UNIFIED_KEY = 'saul_calls_unified';
const DRAFT_FIELDS = ['candidate', 'prompt', 'raw', 'error', 'building'] as const;

async function legacyPart(keys: readonly string[]) {
  const data = await chrome.storage.local.get(LEGACY_CALL_STATE_KEY);
  const value: unknown = data[LEGACY_CALL_STATE_KEY];
  if (value === undefined) return {};
  return record(value)
    ? Object.fromEntries(Object.entries(value).filter(([key]) => keys.includes(key)))
    : value;
}

function localRecord(value: unknown): { revision: number; value: unknown } {
  if (
    record(value) &&
    Number.isSafeInteger(value.revision) &&
    Number(value.revision) > 0 &&
    Object.hasOwn(value, 'value') &&
    Object.keys(value).length === 2
  )
    return { revision: Number(value.revision), value: value.value ?? null };
  return { revision: 0, value };
}

function isCurrent(value: unknown) {
  return record(value) && Object.hasOwn(value, 'schema');
}

function choiceRecord(source: CallChoiceSource, value: unknown): SavedCallChoices {
  try {
    return {
      state: 'ready',
      source,
      choices: isCurrent(value) ? deserializeChoices(value) : legacyChoices(value),
    };
  } catch (error) {
    return {
      state: 'invalid',
      source,
      error: error instanceof Error ? error.message : String(error),
      recovery: recoverChoices(value),
    };
  }
}

/** The background serializes choice migrations and writes. Draft writes never touch choices. */
export function createCustomActionStore(
  readLegacyBuiltinPresetId?: () => Promise<string | undefined>,
): CallEditorStorage & {
  readLibrary(): Promise<ActionChoice[]>;
  migrationComplete(): Promise<boolean>;
} {
  let pending: Promise<unknown> = Promise.resolve();
  function choiceOperation<T>(work: () => Promise<T>) {
    const next = pending.then(work);
    pending = next.catch(() => undefined);
    return next;
  }

  async function saveChoices(source: CallChoiceSource, choices: CallChoices) {
    if (source.migrationBlocked) throw new Error(source.migrationBlocked);
    const value = serializeChoices(choices);
    const data = await chrome.storage.local.get([CHOICES_KEY, UNIFIED_KEY]);
    if (source.kind === 'chrome') {
      if (data[UNIFIED_KEY] || source.revision !== localRecord(data[CHOICES_KEY]).revision)
        throw new Error('Saved Calls changed. Reload the saved selection.');
      await chrome.storage.local.set({
        [CHOICES_KEY]: { revision: source.revision + 1, value },
      });
      return;
    }
    // The pending marker prevents fallback after a write with unknown delivery.
    if (!data[UNIFIED_KEY]) await chrome.storage.local.set({ [UNIFIED_KEY]: 'pending' });
    try {
      await scopedCall({
        action: 'config-save',
        section: 'calls',
        revision: source.revision,
        value,
      });
    } catch (error) {
      if (!(error instanceof ConfigUnavailableError)) throw error;
      throw new Error(
        'Could not confirm the saved Call preset. Check the current selection before changing it again.',
        { cause: error },
      );
    }
    if (data[UNIFIED_KEY] !== true) {
      try {
        await chrome.storage.local.set({ [UNIFIED_KEY]: true });
      } catch {
        // The shared write is acknowledged. The pending marker still prevents
        // fallback while the helper is out, and the next read can confirm it.
      }
    }
  }

  const readChoices = (): Promise<SavedCallChoices> =>
    choiceOperation(async () => {
      const data = await chrome.storage.local.get([CHOICES_KEY, UNIFIED_KEY]);
      const local = localRecord(data[CHOICES_KEY]);
      let source: CallChoiceSource;
      let configValue: unknown;
      try {
        const config = await scopedCall({ action: 'config-read', section: 'calls' });
        source = { kind: 'shared', revision: config.revision };
        if (config.value && data[UNIFIED_KEY] !== true) {
          try {
            await chrome.storage.local.set({ [UNIFIED_KEY]: true });
          } catch (error) {
            if (data[UNIFIED_KEY] !== 'pending') throw error;
          }
        }
        if (!config.value && data[UNIFIED_KEY] === true) return choiceRecord(source, {});
        configValue = config.value;
      } catch (error) {
        if (data[UNIFIED_KEY] || !(error instanceof ConfigUnavailableError)) throw error;
        source = { kind: 'chrome', revision: local.revision };
      }

      const value =
        configValue ??
        (local.value !== undefined ? local.value : await legacyPart(LEGACY_CHOICE_FIELDS));
      const saved = choiceRecord(source, value);
      if (saved.state !== 'ready') return saved;
      if (isCurrent(value)) {
        if (source.kind === 'chrome' || configValue !== undefined) return saved;
        // Promote the existing Chrome selection before exposing a shared revision.
        await saveChoices(source, saved.choices);
        return { ...saved, source: { ...source, revision: source.revision + 1 } };
      }
      let builtinPresetId: string | undefined;
      if (readLegacyBuiltinPresetId) {
        try {
          builtinPresetId = await readLegacyBuiltinPresetId();
        } catch (error) {
          // A legacy custom choice still identifies its saved attempts.
          // Keep the unconverted record intact until the legacy settings can be read.
          return {
            ...saved,
            source: {
              ...source,
              migrationBlocked: error instanceof Error ? error.message : String(error),
            },
          };
        }
      } else if (Object.keys(value as object).length === 0) return saved;

      const choices = { ...saved.choices, builtinPresetId };
      await saveChoices(source, choices);
      return {
        state: 'ready',
        source: { ...source, revision: source.revision + 1 },
        choices,
      };
    });

  return {
    readChoices,
    async readLibrary() {
      const saved = await readChoices();
      return saved.state === 'ready'
        ? (saved.choices.library ?? []).filter((choice) => choice.revision.approved === true)
        : [];
    },
    saveChoices: (source, choices) => choiceOperation(() => saveChoices(source, choices)),
    async migrationComplete() {
      // This check can run inside a Settings commit. Do not wait on the choice
      // lane because a choice migration may be waiting to read Settings.
      const data = await chrome.storage.local.get([CHOICES_KEY, UNIFIED_KEY]);
      let value: unknown;
      try {
        const config = await scopedCall({ action: 'config-read', section: 'calls' });
        if (!config.value && data[UNIFIED_KEY] === true) return true;
        value = config.value;
      } catch (error) {
        if (data[UNIFIED_KEY] || !(error instanceof ConfigUnavailableError)) return false;
        value = localRecord(data[CHOICES_KEY]).value;
      }
      return (
        isCurrent(value) && choiceRecord({ kind: 'chrome', revision: 0 }, value).state === 'ready'
      );
    },
    async readDraft() {
      const data = await chrome.storage.local.get(DRAFT_KEY);
      const draft = data[DRAFT_KEY] ?? (await legacyPart(DRAFT_FIELDS));
      validatePart(draft, DRAFT_FIELDS);
      if (data[DRAFT_KEY] === undefined && record(draft) && Object.keys(draft).length)
        await chrome.storage.local.set({ [DRAFT_KEY]: draft });
      return draft as SavedCallDraft;
    },
    async saveDraft(draft) {
      validatePart(draft, DRAFT_FIELDS);
      await chrome.storage.local.set({ [DRAFT_KEY]: draft });
    },
  };
}
