import {
  WINDOW_TARGET,
  type WindowMessage,
  type WorkspaceRequest,
  type WorkspaceResultFor,
} from './workspace';
import { request } from '../platform/chrome/messages';

export function sendWorkspaceMessage<T extends WorkspaceRequest>(
  message: T,
): Promise<WorkspaceResultFor<T>> {
  return request({ type: WINDOW_TARGET, ...message } satisfies WindowMessage);
}
