import type { CallControl, CallLaunch } from '../../shared/model/call-batch.ts';
import type { CallEditRequest } from './contract';
import { request } from '../platform/chrome/messages';
import {
  CALL_CONTROL,
  CALL_EDIT,
  CALL_LAUNCH,
  type CallControlMessage,
  type CallControlReply,
  type CallEditMessage,
  type CallEditReply,
  type CallLaunchMessage,
  type CallLaunchReply,
} from './messages';

export function sendDigestMessage<T extends CallControl>(message: T): Promise<CallControlReply<T>> {
  return request({ target: CALL_CONTROL, message } satisfies CallControlMessage);
}
export function editCall(message: CallEditRequest): Promise<CallEditReply> {
  return request({ target: CALL_EDIT, message } satisfies CallEditMessage);
}
export function launchCall(message: CallLaunch): Promise<CallLaunchReply> {
  return request({ target: CALL_LAUNCH, message } satisfies CallLaunchMessage);
}
