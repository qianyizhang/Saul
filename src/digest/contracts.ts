import { id, record } from '../contracts/reading';
import type { DigestRequest } from './types';
export function validateDigest(v: unknown): asserts v is DigestRequest {
  if (!record(v)) throw new Error('Invalid digest request');
  const keys: Record<string, string[]> = {
    list: [],
    start: ['id', 'windowId', 'accountId'],
    get: ['id'],
    stop: ['id'],
    retry: ['id'],
    delete: ['id'],
  };
  if (
    typeof v.action !== 'string' ||
    !Object.hasOwn(keys, v.action) ||
    Object.keys(v).some((k) => k !== 'action' && !keys[v.action as string]!.includes(k)) ||
    (v.action !== 'list' && !id(v.id)) ||
    (v.action === 'start' &&
      (!Number.isSafeInteger(v.windowId) ||
        (v.windowId as number) < 0 ||
        typeof v.accountId !== 'string' ||
        !v.accountId ||
        v.accountId.length > 256))
  )
    throw new Error('Invalid digest request');
}
