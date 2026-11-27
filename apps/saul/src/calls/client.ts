import type { CallControl, CallLaunch, DigestResult } from '../../shared/model/call-batch.ts';
import type { CallEditRequest, CallEditorState } from './contract';
import { request } from '../platform/chrome/messages';
import { CALL_LAUNCH, type CallLaunchMessage, type CallLaunchReply } from './messages';

export function sendDigestMessage<T extends CallControl>(message: T): Promise<DigestResult<T>> {
  return request({ target: 'saul-digest', message });
}
export function editCall(message: CallEditRequest): Promise<CallEditorState> {
  return request({ target: 'saul-action', message });
}

export function launchCall(message: CallLaunch): Promise<CallLaunchReply> {
  return request({ target: CALL_LAUNCH, message } satisfies CallLaunchMessage);
}
