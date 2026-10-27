import { id, record } from '../contracts/reading';
import type { DigestRequest } from './types';
export function validateDigest(v: unknown): asserts v is DigestRequest {
  if (!record(v)) throw new Error('Invalid digest request');
  const keys: Record<string, string[]> = {
    list: [],
    active: [],
    start: ['id', 'tabIds', 'accountId', 'regenerate'],
    resolve: ['id', 'tabIds'],
    inspect: ['id', 'index', 'tabId'],
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
    (['start', 'resolve'].includes(v.action) &&
      (!Array.isArray(v.tabIds) ||
        !v.tabIds.length ||
        v.tabIds.length > 1000 ||
        new Set(v.tabIds).size !== v.tabIds.length ||
        !v.tabIds.every((id) => Number.isSafeInteger(id) && id >= 0))) ||
    (v.action === 'start' &&
      (typeof v.accountId !== 'string' ||
        !v.accountId ||
        v.accountId.length > 256 ||
        (v.regenerate !== undefined && typeof v.regenerate !== 'boolean'))) ||
    (v.action === 'inspect' &&
      (!Number.isSafeInteger(v.index) ||
        (v.index as number) < 0 ||
        (v.index as number) >= 1000 ||
        (v.tabId !== undefined && (!Number.isSafeInteger(v.tabId) || (v.tabId as number) < 0))))
  )
    throw new Error('Invalid digest request');
}
