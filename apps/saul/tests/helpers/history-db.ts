import { createHistoryRequest } from '../../shared/protocol/history-protocol.mts';
import type { DbOperations, DbRequest, DbType } from '../../shared/protocol/history-types.ts';

interface TestHistory {
  run(request: unknown): Promise<{ value: unknown }>;
}

// Tests use the same validated, owner-scoped entry point as the installed storage helper.
export async function executeHistory<K extends DbType>(
  store: TestHistory,
  message: DbRequest<K>,
  owner = '495b94ab-a8c8-459b-b476-59ab80e55adb',
): Promise<DbOperations[K]['result']> {
  const request = createHistoryRequest(owner, crypto.randomUUID(), message as DbRequest);
  const result = await store.run(request);
  return (result.value ?? undefined) as DbOperations[K]['result'];
}
