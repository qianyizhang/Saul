import { HISTORY_IDENTITY_TARGET, type HistoryIdentityReply } from '../native/control-messages';
import {
  createHistoryRequest,
  historyRequestPolicy,
  type HistoryRequest,
} from '../../shared/protocol/history-protocol.mts';
import type { DbCall, DbRequest } from '../../shared/protocol/history-types.ts';
import { requestHistory } from '../native/storage-client';
import { StorageDisconnected } from '../native/storage-connection';

let owner: Promise<string> | undefined;
function profileOwner(): Promise<string> {
  return (owner ??= chrome.runtime
    .sendMessage({ target: HISTORY_IDENTITY_TARGET })
    .then((reply: HistoryIdentityReply | undefined) => {
      if (!reply?.success) throw new Error(reply?.error || 'History profile identity unavailable.');
      if (typeof reply.result !== 'string')
        throw new Error('History profile identity unavailable.');
      return reply.result;
    })
    .catch((cause: unknown) => {
      owner = undefined;
      throw cause;
    }));
}

export async function historyCall(request: HistoryRequest): Promise<unknown> {
  const policy = historyRequestPolicy(request);
  for (let attempt = 0; ; attempt++) {
    try {
      return await requestHistory({ action: 'history', request });
    } catch (error) {
      if (!(error instanceof StorageDisconnected)) throw error;
      if (policy === 'explicit-write')
        throw new Error(
          'The History write may have been applied. Refresh the affected view before trying again.',
          { cause: error },
        );
      if (attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
}

export const sharedDb: DbCall = async (message) => {
  const request = createHistoryRequest(
    await profileOwner(),
    crypto.randomUUID(),
    message as DbRequest,
  );
  const value = await historyCall(request);
  return (value === null ? undefined : value) as never;
};
