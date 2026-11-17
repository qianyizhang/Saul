import type { CallPresetPreparation } from './editor';
import type { Reply } from '../../shared/protocol/history-types.ts';
import type {
  CallChoices,
  CallChoiceSource,
  CallEditorStorage,
  SavedCallChoices,
  SavedCallDraft,
} from './contract';

export type CallEditorBridgeRequest =
  | { action: 'read-choices' }
  | { action: 'save-choices'; source: CallChoiceSource; choices: CallChoices }
  | { action: 'read-draft' }
  | { action: 'save-draft'; draft: SavedCallDraft }
  | { action: 'prepare-preset'; presetId: string };

async function request<T>(message: CallEditorBridgeRequest): Promise<T> {
  // Offscreen documents only have the runtime API. The background owns storage.
  const response: Reply<T> = await chrome.runtime.sendMessage({
    target: 'saul-call-editor',
    message,
  });
  if (!response?.success) throw new Error(response?.error || 'Could not access saved Calls.');
  return response.result;
}
export const callEditorStorage: CallEditorStorage = {
  readChoices: () => request<SavedCallChoices>({ action: 'read-choices' }),
  saveChoices: (source, choices) => request({ action: 'save-choices', source, choices }),
  readDraft: () => request<SavedCallDraft>({ action: 'read-draft' }),
  saveDraft: (draft) => request({ action: 'save-draft', draft }),
};
export const prepareCallPreset: CallPresetPreparation = (presetId) =>
  request({ action: 'prepare-preset', presetId });
