import { isBoundedText, isId, isRecord } from '../../shared/model/value.mts';
import type {
  ContextPolicy,
  ResolvedContext,
  SelectionSnapshot,
} from '../../shared/model/reading.ts';
import type { Passage, RunResult } from '../../shared/protocol/history-types.ts';

type EmptyResult = Record<string, never>;
export const READING_TARGET = 'saul-reading';
export const OPEN_SOURCE_TARGET = 'saul-open-source';
export const SOURCE_READY_TARGET = 'saul-source-ready';
export const READING_EVENTS_TARGET = 'saul-events';
export type ReadingMessage =
  | { target: typeof READING_TARGET; message: ReadingRequest }
  | { target: typeof OPEN_SOURCE_TARGET; selectionId: string }
  | { target: typeof SOURCE_READY_TARGET }
  | { target: typeof READING_EVENTS_TARGET; url: string };
export type OpenSourceMessage = { type: 'SAUL_OPEN'; selectionId: string };
export type OpenSourceReply = { received: boolean };
export type ReadingEvent =
  | { type: 'changed' }
  | { type: 'notifications'; muted: boolean }
  | { type: 'presentation'; minimum: boolean }
  | { type: 'configuration' };

export function receivedSource(value: unknown): boolean {
  return isRecord(value) && value.received === true;
}
export interface ReadingOperations {
  review: {
    request: { action: 'review'; selectionId: string; context: ResolvedContext; recipeId?: string };
    result: import('./input-change').InputComparison;
  };
  image: {
    request: { action: 'image'; selectionId: string; runId: string };
    result: import('../../shared/protocol/history-types.ts').DbOperations['DB_IMAGE']['result'];
  };
  list: { request: { action: 'list' }; result: { passages: Passage[] } };
  policy: {
    request: { action: 'policy' };
    result: {
      policy: ContextPolicy;
      recipes: {
        id: string;
        name: string;
        presetName: string;
        fast: boolean;
        capability?: 'write' | 'draw';
        outputFormat?: 'png' | 'gif';
      }[];
      selectedRecipeId: string;
    };
  };
  'mute-errors': {
    request: { action: 'mute-errors'; muted: boolean };
    result: EmptyResult;
  };
  submit: {
    request: {
      action: 'submit';
      submissionId: string;
      snapshot: SelectionSnapshot;
      context: ResolvedContext;
      recipeId?: string;
      outputFormat?: 'png' | 'gif';
      regenerate?: boolean;
    };
    result: { passageId: string; reused: boolean };
  };
  regenerate: {
    request: {
      action: 'regenerate';
      submissionId: string;
      selectionId: string;
      instruction?: string;
      runId?: string;
      recipeId?: string;
    };
    result: { passageId: string; reused: boolean };
  };
  stop: { request: { action: 'stop'; selectionId: string }; result: EmptyResult };
  runs: {
    request: { action: 'runs'; selectionId: string };
    result: { runs: RunResult[] };
  };
  bookmark: {
    request: { action: 'bookmark'; selectionId: string; bookmarked: boolean };
    result: EmptyResult;
  };
  view: {
    request: { action: 'view'; selectionId: string; runId: string };
    result: EmptyResult;
  };
}
export type ReadingAction = keyof ReadingOperations;
export type ReadingRequest<K extends ReadingAction = ReadingAction> =
  ReadingOperations[K]['request'];
export type ReadingResult<K extends ReadingAction = ReadingAction> = ReadingOperations[K]['result'];
export type ReadingResultFor<T extends ReadingRequest> = T extends {
  action: infer K extends ReadingAction;
}
  ? ReadingResult<K>
  : never;

const text = (value: unknown, maxLength = 10_000) => isBoundedText(value, maxLength);
const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
function validSnapshot(v: unknown): v is SelectionSnapshot {
  if (
    !isRecord(v) ||
    !isId(v.id) ||
    !text(v.text) ||
    !v.text.trim() ||
    !isRecord(v.page) ||
    !isRecord(v.anchor) ||
    !isRecord(v.viewport)
  )
    return false;
  const anchor = v.anchor,
    viewport = v.viewport;
  return (
    text(v.page.url) &&
    text(v.page.title) &&
    (v.page.canonicalUrl === undefined || text(v.page.canonicalUrl)) &&
    text(v.anchor.exact) &&
    text(v.anchor.prefix, 1000) &&
    text(v.anchor.suffix, 1000) &&
    (v.anchor.domPath === undefined || text(v.anchor.domPath)) &&
    ['textStart', 'textEnd'].every(
      (k) =>
        anchor[k] === undefined || (Number.isSafeInteger(anchor[k]) && (anchor[k] as number) >= 0),
    ) &&
    ['x', 'y', 'width', 'height', 'scrollX', 'scrollY'].every((k) => number(viewport[k])) &&
    number(v.capturedAt)
  );
}
function validContext(v: unknown): v is ResolvedContext {
  return (
    isRecord(v) &&
    text(v.selection) &&
    text(v.pageTitle) &&
    text(v.pageUrl) &&
    ['paragraph', 'heading', 'surroundingText'].every(
      (k) => v[k] === undefined || text(v[k], 20000),
    )
  );
}
export function validateReading(v: unknown): asserts v is ReadingRequest {
  if (!isRecord(v)) throw new Error('Invalid reading request');
  let valid = false;
  switch (v.action) {
    case 'list':
    case 'policy':
      valid = true;
      break;
    case 'submit':
      valid =
        isId(v.submissionId) &&
        (v.outputFormat === undefined || v.outputFormat === 'png' || v.outputFormat === 'gif') &&
        validSnapshot(v.snapshot) &&
        validContext(v.context) &&
        (v.regenerate === undefined || typeof v.regenerate === 'boolean') &&
        (v.recipeId === undefined || isId(v.recipeId));
      break;
    case 'review':
      valid =
        isId(v.selectionId) &&
        validContext(v.context) &&
        (v.recipeId === undefined || isId(v.recipeId));
      break;
    case 'mute-errors':
      valid = typeof v.muted === 'boolean';
      break;
    case 'regenerate':
      valid =
        isId(v.submissionId) &&
        isId(v.selectionId) &&
        (v.recipeId === undefined || isId(v.recipeId)) &&
        (v.runId === undefined || isId(v.runId)) &&
        (v.instruction === undefined || text(v.instruction, 2000));
      break;
    case 'image':
      valid = isId(v.selectionId) && isId(v.runId);
      break;
    case 'stop':
    case 'runs':
      valid = isId(v.selectionId);
      break;
    case 'bookmark':
      valid = isId(v.selectionId) && typeof v.bookmarked === 'boolean';
      break;
    case 'view':
      valid = isId(v.selectionId) && isId(v.runId);
      break;
  }
  if (!valid) throw new Error('Invalid reading request');
}
