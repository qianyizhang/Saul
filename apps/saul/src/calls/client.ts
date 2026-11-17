import type { DigestRequest, DigestResult } from '../../shared/model/call-batch.ts';
import type { CallEditRequest, CallEditorState } from './contract';
import { request } from '../platform/chrome/messages';

export function sendDigestMessage<T extends DigestRequest>(message: T): Promise<DigestResult<T>> {
  return request({ target: 'saul-digest', message });
}
export function editCall(message: CallEditRequest): Promise<CallEditorState> {
  return request({ target: 'saul-action', message });
}
