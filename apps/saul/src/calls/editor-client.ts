import type { CallPresetPreparation } from './editor';
import type { CallEditorStorage } from '../custom-actions/contract';
import { request } from '../platform/chrome/messages';
import {
  CALL_EDITOR_STORAGE,
  type CallEditorBridgeRequest,
  type CallEditorStorageReplies,
} from './messages';

export function requestCallEditorStorage<T extends CallEditorBridgeRequest>(
  message: T,
): Promise<CallEditorStorageReplies[T['action']]> {
  // Offscreen documents only have the runtime API. The background owns storage.
  return request({ target: CALL_EDITOR_STORAGE, message }, 'Could not access saved Calls.');
}

export const callEditorStorage: CallEditorStorage = {
  readChoices: () => requestCallEditorStorage({ action: 'read-choices' }),
  saveChoices: (source, choices) =>
    requestCallEditorStorage({ action: 'save-choices', source, choices }),
  readDraft: () => requestCallEditorStorage({ action: 'read-draft' }),
  saveDraft: (draft) => requestCallEditorStorage({ action: 'save-draft', draft }),
};
export const prepareCallPreset: CallPresetPreparation = (presetId) =>
  requestCallEditorStorage({ action: 'prepare-preset', presetId });
