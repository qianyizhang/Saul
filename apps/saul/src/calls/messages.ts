import type {
  CallLaunch,
  CallLaunchResult,
  CallControl,
  DigestResult,
  DigestCapture,
  DigestItem,
} from '../../shared/model/call-batch.ts';
import { isRecord } from '../../shared/model/value.mts';
import type { PreparedModel } from '../configuration/resolver';
import {
  validateSavedActionState,
  type CallChoices,
  type CallChoiceSource,
  type CallEditorStorage,
  type SavedCallDraft,
} from '../custom-actions/contract';
import type { CallEditRequest, CallEditorState } from './contract';

export const CALL_LAUNCH = 'saul-call-launch';
export type CallLaunchMessage = { target: typeof CALL_LAUNCH; message: CallLaunch };
export type CallLaunchReply = CallLaunchResult;

export const CALL_CONTROL = 'saul-digest';
export type CallControlMessage = { target: typeof CALL_CONTROL; message: CallControl };
export type CallControlReply<T extends CallControl> = DigestResult<T>;
export const CALL_EDIT = 'saul-action';
export type CallEditMessage = { target: typeof CALL_EDIT; message: CallEditRequest };
export type CallEditReply = CallEditorState;

export const CALL_EDITOR_STORAGE = 'saul-call-editor';
export type CallEditorBridgeRequest =
  | { action: 'read-choices' }
  | { action: 'save-choices'; source: CallChoiceSource; choices: CallChoices }
  | { action: 'read-draft' }
  | { action: 'save-draft'; draft: SavedCallDraft }
  | { action: 'prepare-preset'; presetId: string };
export interface CallEditorStorageReplies {
  'read-choices': Awaited<ReturnType<CallEditorStorage['readChoices']>>;
  'save-choices': Awaited<ReturnType<CallEditorStorage['saveChoices']>>;
  'read-draft': Awaited<ReturnType<CallEditorStorage['readDraft']>>;
  'save-draft': Awaited<ReturnType<CallEditorStorage['saveDraft']>>;
  'prepare-preset': PreparedModel;
}

export function validateCallEditorBridge(value: unknown): asserts value is CallEditorBridgeRequest {
  if (isRecord(value)) {
    switch (value.action) {
      case 'read-choices':
      case 'read-draft':
        return;
      case 'save-choices': {
        const source = value.source;
        if (
          !isRecord(source) ||
          (source.kind !== 'chrome' && source.kind !== 'shared') ||
          typeof source.revision !== 'number' ||
          !Number.isSafeInteger(source.revision) ||
          source.revision < 0 ||
          (source.migrationBlocked !== undefined && typeof source.migrationBlocked !== 'string')
        )
          break;
        validateSavedActionState(value.choices);
        return;
      }
      case 'save-draft':
        validateSavedActionState(value.draft);
        return;
      case 'prepare-preset':
        if (typeof value.presetId === 'string') return;
    }
  }
  throw new Error('Invalid Call storage request.');
}

export const DIGEST_CAPTURE = 'saul-digest-capture';
export type CaptureTabSource = Pick<DigestItem, 'tabId' | 'url' | 'title'>;
type CaptureMessage = { target: typeof DIGEST_CAPTURE; item: CaptureTabSource };
type CaptureRequest = CaptureMessage & { verifyOnly?: false };
type VerifyRequest = CaptureMessage & { verifyOnly: true };
export type DigestCaptureMessage = CaptureRequest | VerifyRequest;
export type DigestCaptureReply<T extends DigestCaptureMessage> = T extends VerifyRequest
  ? void
  : DigestCapture;
export type DigestCaptureHandlers = {
  capture: (item: CaptureTabSource) => Promise<DigestCaptureReply<CaptureRequest>>;
  verify: (item: CaptureTabSource) => Promise<DigestCaptureReply<VerifyRequest>>;
};

export function validateDigestCapture(value: unknown): asserts value is DigestCaptureMessage {
  if (
    !isRecord(value) ||
    value.target !== DIGEST_CAPTURE ||
    (value.verifyOnly !== undefined && typeof value.verifyOnly !== 'boolean') ||
    !isRecord(value.item) ||
    typeof value.item.tabId !== 'number' ||
    !Number.isSafeInteger(value.item.tabId) ||
    value.item.tabId < 0 ||
    typeof value.item.url !== 'string' ||
    typeof value.item.title !== 'string'
  )
    throw new Error('Invalid Summary capture request.');
}
