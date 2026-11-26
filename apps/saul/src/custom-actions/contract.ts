import { actionChoiceKey, type ActionChoice } from '../../shared/model/custom-action.ts';
import type { ActionRevision } from '../../shared/protocol/action-protocol.mts';
import { validRevision, validateActionModule } from '../../shared/protocol/action-protocol.mts';
import { isRecord as record } from '../../shared/model/value.mts';

export interface CallChoices {
  builtinPresetId?: string;
  library?: ActionChoice[];
  selected?: ActionChoice;
  previous?: ActionChoice;
}
export interface CallDraft {
  candidate?: ActionRevision;
  prompt?: string;
  raw?: string;
  error?: string;
}
export type SavedCallDraft = CallDraft & { building?: boolean };
export type CallChoiceSource = {
  kind: 'chrome' | 'shared';
  revision: number;
  migrationBlocked?: string;
};
export type SavedCallChoices = { source: CallChoiceSource } & (
  | { state: 'ready'; choices: CallChoices }
  | { state: 'invalid'; error: string; recovery?: CallChoices }
);
export interface CallEditorStorage {
  readChoices(): Promise<SavedCallChoices>;
  saveChoices(source: CallChoiceSource, choices: CallChoices): Promise<void>;
  readDraft(): Promise<SavedCallDraft>;
  saveDraft(draft: SavedCallDraft): Promise<void>;
}
export const LEGACY_CALL_STATE_KEY = 'saul_summary_action_v1';
export const ACTION_BUILDER_PROMPT_LIMIT = 8000;
export const ACTION_PRESET_ID_LIMIT = 128;

export function validateSavedActionState(
  value: unknown,
): asserts value is SavedCallDraft & CallChoices {
  if (
    !record(value) ||
    Object.keys(value).some(
      (k) =>
        ![
          'builtinPresetId',
          'library',
          'selected',
          'previous',
          'candidate',
          'prompt',
          'raw',
          'error',
          'building',
        ].includes(k),
    )
  )
    throw new Error('Call settings are invalid. Choose Use Summarize to recover.');
  const revision = (v: unknown) => {
    if (
      !record(v) ||
      !validRevision(v.revision) ||
      typeof v.createdAt !== 'number' ||
      !Number.isFinite(v.createdAt) ||
      (v.approved !== undefined && typeof v.approved !== 'boolean')
    )
      throw new Error('Invalid saved action revision.');
    const { contractVersion, name, description, language, source } = v;
    validateActionModule({ contractVersion, name, description, language, source });
  };
  if (
    value.builtinPresetId !== undefined &&
    (typeof value.builtinPresetId !== 'string' ||
      !value.builtinPresetId.trim() ||
      value.builtinPresetId.length > ACTION_PRESET_ID_LIMIT)
  )
    throw new Error('Invalid summary model preset reference.');
  if (value.library !== undefined) {
    if (!Array.isArray(value.library) || value.library.length > 128)
      throw new Error('Keep at most 128 call presets.');
    for (const choice of value.library) validateSavedActionState({ selected: choice });
    const ids = value.library.map(actionChoiceKey);
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate call presets.');
  }
  for (const key of ['selected', 'previous'] as const)
    if (value[key] !== undefined) {
      const choice = value[key];
      if (
        !record(choice) ||
        typeof choice.presetId !== 'string' ||
        !choice.presetId ||
        choice.presetId.length > ACTION_PRESET_ID_LIMIT
      )
        throw new Error('Invalid action preset reference.');
      revision(choice.revision);
    }
  if (value.candidate !== undefined) revision(value.candidate);
  for (const [key, limit] of [
    ['prompt', ACTION_BUILDER_PROMPT_LIMIT],
    ['raw', 100_000],
    ['error', 100_000],
  ] as const)
    if (
      value[key] !== undefined &&
      (typeof value[key] !== 'string' || (value[key] as string).length > limit)
    )
      throw new Error('Invalid saved action draft.');
  if (value.building !== undefined && typeof value.building !== 'boolean')
    throw new Error('Invalid action status.');
}
