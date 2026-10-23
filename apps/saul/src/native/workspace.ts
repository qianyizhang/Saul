import { handleTabCallUnlocked, withTabLock } from './tabs';
import {
  validateCall,
  type TabSnapshot,
  type ToolArgs,
  type ToolResults,
} from '../../native/protocol.mts';
import { record } from '../contracts/reading';
type WorkspaceCommandTool =
  | 'saul_tabs_edit'
  | 'saul_tabs_undo'
  | 'saul_summary_open'
  | 'saul_summary_status';
type WorkspaceCommandRequest = {
  [K in WorkspaceCommandTool]: {
    action: 'command';
    method: K;
    args: Omit<ToolArgs[K], 'session'>;
  };
}[WorkspaceCommandTool];
export type WorkspaceRequest = { action: 'list' } | WorkspaceCommandRequest;
export type WorkspaceResultFor<T extends WorkspaceRequest> = T extends {
  action: 'command';
  method: infer K extends WorkspaceCommandTool;
}
  ? ToolResults[K]
  : { snapshot: TabSnapshot };
export function validateWorkspaceRequest(value: unknown): asserts value is WorkspaceRequest {
  if (!record(value)) throw new Error('Invalid tab action');
  if (value.action === 'list') return;
  if (
    value.action !== 'command' ||
    !['saul_tabs_edit', 'saul_tabs_undo', 'saul_summary_open', 'saul_summary_status'].includes(
      String(value.method),
    ) ||
    !record(value.args) ||
    'session' in value.args
  )
    throw new Error('Invalid tab action');
  validateCall(String(value.method), value.args);
}
export function workspaceCall(request: unknown) {
  validateWorkspaceRequest(request);
  return withTabLock(async () =>
    request.action === 'list'
      ? { snapshot: await handleTabCallUnlocked('saul_tabs_list') }
      : handleTabCallUnlocked(request.method, request.args),
  );
}
