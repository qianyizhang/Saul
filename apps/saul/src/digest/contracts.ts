import { id, record } from '../contracts/reading';
import type { DigestRequest } from './types';
export function validateDigest(v: unknown): asserts v is DigestRequest {
  if (!record(v)) throw new Error('Invalid digest request');
  const keys: Record<string, string[]> = {
    list: [],
    active: [],
    start: ['id', 'tabIds', 'accountId'],
    get: ['id'],
    stop: ['id'],
    retry: ['id'],
    delete: ['id'],
  };
  if (
    typeof v.action !== 'string' ||
    !Object.hasOwn(keys, v.action) ||
    Object.keys(v).some((k) => k !== 'action' && !keys[v.action as string]!.includes(k)) ||
    (!['list', 'active'].includes(v.action) && !id(v.id)) ||
    (v.action === 'start' &&
      (!Array.isArray(v.tabIds) ||
        !v.tabIds.length ||
        v.tabIds.length > 1000 ||
        new Set(v.tabIds).size !== v.tabIds.length ||
        !v.tabIds.every((id) => Number.isSafeInteger(id) && id >= 0) ||
        typeof v.accountId !== 'string' ||
        !v.accountId ||
        v.accountId.length > 256))
  )
    throw new Error('Invalid digest request');
}
