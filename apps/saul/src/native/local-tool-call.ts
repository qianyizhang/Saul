import { readToolHistory } from './storage-bridge';
import {
  localAccessSettingsPath,
  organizePermission,
  summaryPermission,
} from '../../shared/protocol/local-access.mts';
import { TOOL_OPERATIONS, validateCall, type ToolName } from '../../shared/protocol/protocol.mts';
import { handleTabCallUnlocked, withTabLock } from './tabs';
import { readLocalAccess } from './local-access';

export function handleLocalToolCall(name: string, input: unknown = {}) {
  return withTabLock(async () => {
    const args = validateCall(name, input);
    const access = await readLocalAccess();
    if (!access.enabled) throw new Error(`Enable Local tool access in ${localAccessSettingsPath}.`);

    const policy = TOOL_OPERATIONS[name as ToolName].access;
    if (policy === 'history-read') {
      if (!access.history) throw new Error(`Enable History Read in ${localAccessSettingsPath}.`);
      if (name === 'saul_history_search') {
        const { session, ...payload } = validateCall(name, input);
        void session;
        return readToolHistory({ type: 'DB_TOOL_HISTORY_SEARCH', payload });
      }
      if (name === 'saul_history_read') {
        const { session, ...payload } = validateCall(name, input);
        void session;
        return readToolHistory({ type: 'DB_TOOL_HISTORY_READ', payload });
      }
    }
    const applying = 'dryRun' in args && args.dryRun === false;
    if ((policy === 'tabs-write' || (policy === 'tabs-preview' && applying)) && !access.organize)
      throw new Error(organizePermission);
    if (policy === 'pages-read' || policy === 'pages-preview') {
      const write = policy === 'pages-preview' && applying;
      if (access.pages === 'off' || (write && access.pages !== 'write'))
        throw new Error(
          `Set Pages to ${write ? 'Write' : 'Read or Write'} in ${localAccessSettingsPath}.`,
        );
    }
    if (policy === 'annotations' && 'operation' in args) {
      const write = args.operation.action === 'create' || args.operation.action === 'change';
      if (access.annotations === 'off' || (write && access.annotations !== 'write'))
        throw new Error(
          `Set Annotations to ${write ? 'Write' : 'Read or Write'} in ${localAccessSettingsPath}.`,
        );
    }
    if (policy === 'summary' && 'tabIds' in args && args.tabIds?.length && access.pages !== 'write')
      throw new Error(summaryPermission);

    if (name === 'saul_tabs_list') {
      const snapshot = await handleTabCallUnlocked(name, args);
      return {
        ...snapshot,
        localAccess: {
          tabs: access.organize ? ('write' as const) : ('read' as const),
          history: access.history ? ('read' as const) : ('off' as const),
          pages: access.pages,
          annotations: access.annotations,
        },
      };
    }
    return handleTabCallUnlocked(name, args);
  });
}
