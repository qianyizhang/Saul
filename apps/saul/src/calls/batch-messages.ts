import { isRecord as record } from '../../shared/model/value.mts';
import type { CallControl, CallLaunch } from '../../shared/model/call-batch.ts';
export const isCallBatchId = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 128;

export function validateCallControl(v: unknown): asserts v is CallControl {
  if (!record(v)) throw new Error('Invalid Call command.');
  const keys: Record<string, string[]> = {
    list: [],
    active: [],
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
    (!['list', 'active'].includes(v.action) && !isCallBatchId(v.id)) ||
    (v.action === 'inspect' &&
      (!Number.isSafeInteger(v.index) ||
        (v.index as number) < 0 ||
        (v.index as number) >= 1000 ||
        (v.tabId !== undefined && (!Number.isSafeInteger(v.tabId) || (v.tabId as number) < 0))))
  )
    throw new Error('Invalid Call command.');
}

export function validateCallLaunch(v: unknown): asserts v is CallLaunch {
  if (
    !record(v) ||
    !Object.keys(v).every((k) => ['id', 'tabIds', 'review', 'previousBatchId'].includes(k)) ||
    !isCallBatchId(v.id) ||
    (v.previousBatchId !== undefined &&
      (!isCallBatchId(v.previousBatchId) || v.previousBatchId === v.id)) ||
    !Array.isArray(v.tabIds) ||
    !v.tabIds.length ||
    v.tabIds.length > 1000 ||
    new Set(v.tabIds).size !== v.tabIds.length ||
    !v.tabIds.every((t) => Number.isSafeInteger(t) && t >= 0) ||
    (v.review !== undefined &&
      (!record(v.review) ||
        typeof v.review.stamp !== 'string' ||
        !/^[0-9a-f]{64}$/.test(v.review.stamp) ||
        (v.review.presetId !== undefined && !isCallBatchId(v.review.presetId)) ||
        !Object.keys(v.review).every((k) => k === 'stamp' || k === 'presetId')))
  )
    throw new Error('Invalid Call launch.');
}
