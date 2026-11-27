import { callTool } from '../native/client.mts';
import { createHistoryRequest } from '../shared/protocol/history-protocol.mts';
import type { ToolResults } from '../shared/protocol/protocol.mts';
import { nativeCredentialCall, credentialCall } from '../src/native/credentials';
import { historyCall } from '../src/storage/history';

export function checkNativeMessageTypes() {
  const unread: Promise<number | null> = historyCall(
    createHistoryRequest('owner', 'id', { type: 'DB_UNREAD', payload: undefined }),
  );
  const inventory: Promise<ToolResults['saul_tabs_list']> = callTool('saul_tabs_list');
  const credential: Promise<{ connectionCoordination: 1 }> = nativeCredentialCall({
    action: 'connection-capabilities',
  });
  // @ts-expect-error Trusted code must use a registered operation name.
  callTool('saul_unregistered');
  // @ts-expect-error History read requires a record ID even when the entire argument is omitted.
  callTool('saul_history_read');
  // @ts-expect-error The argument does not belong to this operation.
  callTool('saul_tabs_list', { ids: [1] });
  // @ts-expect-error A streaming operation cannot use the terminal reply client.
  credentialCall({ action: 'api-chat', model: 'fixture', systemPrompt: '', userPrompt: 'sample' });
  // @ts-expect-error The History payload must match the operation.
  createHistoryRequest('owner', 'id', { type: 'DB_PASSAGE', payload: undefined });
  return { unread, inventory, credential };
}
