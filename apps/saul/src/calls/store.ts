import { type CallChoice } from '../../shared/model/custom-call.ts';
import {
  LEGACY_CALL_STATE_KEY,
  validateCallEditorState,
  type CallChoices,
  type CallChoiceSource,
  type CallEditorStorage,
  type SavedCallChoices,
  type SavedCallDraft,
} from './contract';
import { record } from '../reading/contract';
import { scopedCall, ConfigUnavailableError } from '../native/config-transport';

const CHOICES_KEY = 'saul_call_choices_v1';
const DRAFT_KEY = 'saul_call_draft_v1';
const UNIFIED_KEY = 'saul_calls_unified';
const CHOICE_FIELDS = ['library', 'selected', 'previous'] as const;
const DRAFT_FIELDS = ['candidate', 'prompt', 'raw', 'error', 'building'] as const;

function fromLegacy(value: unknown, keys: readonly string[]) {
  if (value === undefined) return {};
  if (!record(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => keys.includes(key)));
}
function validatePart(value: unknown, keys: readonly string[]) {
  validateCallEditorState(value);
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error('Invalid Call data.');
}
function choicesFromStored(value: unknown): CallChoices {
  validatePart(value, CHOICE_FIELDS);
  const choices = value as CallChoices;
  if (choices.library) return choices;
  // Preserve both choices from the earlier two-slot store.
  const library = new Map<string, CallChoice>();
  for (const choice of [choices.previous, choices.selected]) {
    if (choice) library.set(`${choice.revision.revision}:${choice.presetId}`, choice);
  }
  return { ...choices, library: [...library.values()] };
}
function choiceRecord(source: CallChoiceSource, value: unknown): SavedCallChoices {
  try {
    return { state: 'ready', source, choices: choicesFromStored(value) };
  } catch (error) {
    return {
      state: 'invalid',
      source,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function legacyPart(keys: readonly string[]) {
  const data = await chrome.storage.local.get(LEGACY_CALL_STATE_KEY);
  return fromLegacy(data[LEGACY_CALL_STATE_KEY], keys);
}

async function localChoices(source: CallChoiceSource, value: unknown): Promise<SavedCallChoices> {
  if (value !== undefined) return choiceRecord(source, value);
  const legacy = await legacyPart(CHOICE_FIELDS);
  const saved = choiceRecord(source, legacy);
  if (saved.state === 'ready' && record(legacy) && Object.keys(legacy).length) {
    // Migrate only real previous choices. Keep the original record untouched.
    await chrome.storage.local.set({ [CHOICES_KEY]: saved.choices });
  }
  return saved;
}

/** The background reads and writes saved choices; draft writes never touch choices. */
export function createCallStore(): CallEditorStorage {
  let pending: Promise<unknown> = Promise.resolve();
  function choiceOperation<T>(work: () => Promise<T>) {
    // Admission can read during editing. Do not let a migration started by a
    // reader overwrite a later selection saved by the editor.
    const next = pending.then(work);
    pending = next.catch(() => undefined);
    return next;
  }
  return {
    readChoices: () =>
      choiceOperation(async () => {
        const data = await chrome.storage.local.get([CHOICES_KEY, UNIFIED_KEY]);
        let config;
        try {
          config = await scopedCall({ action: 'config-read', section: 'calls' });
        } catch (error) {
          if (data[UNIFIED_KEY] || !(error instanceof ConfigUnavailableError)) throw error;
          return localChoices({ kind: 'chrome' }, data[CHOICES_KEY]);
        }
        // The existing marker is true once a nonempty shared scope was observed.
        // A pending first save can be rejected before a scope exists.
        if (config.value && data[UNIFIED_KEY] !== true) {
          try {
            await chrome.storage.local.set({ [UNIFIED_KEY]: true });
          } catch (error) {
            // A pending marker already prevents fallback while the helper is down.
            if (data[UNIFIED_KEY] !== 'pending') throw error;
          }
        }
        const source = { kind: 'shared', revision: config.revision } as const;
        return config.value || data[UNIFIED_KEY] === true
          ? choiceRecord(source, config.value ?? {})
          : localChoices(source, data[CHOICES_KEY]);
      }),
    saveChoices: (source, choices) =>
      choiceOperation(async () => {
        validatePart(choices, CHOICE_FIELDS);
        if (source.kind === 'chrome') {
          if ((await chrome.storage.local.get(UNIFIED_KEY))[UNIFIED_KEY])
            throw new Error('Call presets now use shared settings. Reload the saved selection.');
          await chrome.storage.local.set({ [CHOICES_KEY]: choices });
          return;
        }
        // Establish the no-fallback boundary before issuing the shared write. A
        // transport loss after dispatch leaves the outcome uncertain, without replay.
        if (!(await chrome.storage.local.get(UNIFIED_KEY))[UNIFIED_KEY])
          await chrome.storage.local.set({ [UNIFIED_KEY]: 'pending' });
        try {
          await scopedCall({
            action: 'config-save',
            section: 'calls',
            revision: source.revision,
            value: { ...choices },
          });
        } catch (error) {
          if (!(error instanceof ConfigUnavailableError)) throw error;
          throw new Error(
            'Could not confirm the saved Call preset. Check the current selection before changing it again.',
            { cause: error },
          );
        }
      }),
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

export const callStore = createCallStore();
