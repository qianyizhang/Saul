import type { WorkspaceRequest, WorkspaceResultFor } from './workspace';
import { request } from '../platform/chrome/messages';

export function sendWorkspaceMessage<T extends WorkspaceRequest>(
  message: T,
): Promise<WorkspaceResultFor<T>> {
  return request({ type: 'WORKSPACE_TABS', ...message });
}
