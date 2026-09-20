import type { ContextPolicy, ResolvedContext, SelectionSnapshot } from '../types';
import type { Passage, RunResult } from '../types/storage';

export type ReadingRequest =
  | { action: 'list' | 'policy' }
  | {
      action: 'submit';
      submissionId: string;
      snapshot: SelectionSnapshot;
      context: ResolvedContext;
    }
  | { action: 'regenerate'; submissionId: string; selectionId: string; instruction?: string }
  | { action: 'stop' | 'runs'; selectionId: string }
  | { action: 'bookmark'; selectionId: string; bookmarked: boolean }
  | { action: 'view'; selectionId: string; runId: string };
export interface ReadingResult {
  passages?: Passage[];
  passageId?: string;
  reused?: boolean;
  policy?: ContextPolicy;
  runs?: RunResult[];
}

export const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export const text = (v: unknown, max = 10000): v is string =>
  typeof v === 'string' && v.length <= max;
export const id = (v: unknown): v is string => text(v, 128) && v.length > 0;
const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
export function validSnapshot(v: unknown): v is SelectionSnapshot {
  if (
    !record(v) ||
    !id(v.id) ||
    !text(v.text) ||
    !v.text.trim() ||
    !record(v.page) ||
    !record(v.anchor) ||
    !record(v.viewport)
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
export function validContext(v: unknown): v is ResolvedContext {
  return (
    record(v) &&
    text(v.selection) &&
    text(v.pageTitle) &&
    text(v.pageUrl) &&
    ['paragraph', 'heading', 'surroundingText'].every(
      (k) => v[k] === undefined || text(v[k], 20000),
    )
  );
}
export function validateReading(v: unknown): asserts v is ReadingRequest {
  if (!record(v)) throw new Error('Invalid reading request');
  let valid = false;
  switch (v.action) {
    case 'list':
    case 'policy':
      valid = true;
      break;
    case 'submit':
      valid = id(v.submissionId) && validSnapshot(v.snapshot) && validContext(v.context);
      break;
    case 'regenerate':
      valid =
        id(v.submissionId) &&
        id(v.selectionId) &&
        (v.instruction === undefined || text(v.instruction, 2000));
      break;
    case 'stop':
    case 'runs':
      valid = id(v.selectionId);
      break;
    case 'bookmark':
      valid = id(v.selectionId) && typeof v.bookmarked === 'boolean';
      break;
    case 'view':
      valid = id(v.selectionId) && id(v.runId);
      break;
  }
  if (!valid) throw new Error('Invalid reading request');
}
export function workspaceSender(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    !!sender.url &&
    ['popup.html', 'library.html'].some(
      (path) => sender.url!.split(/[?#]/)[0] === chrome.runtime.getURL(path),
    )
  );
}
export function backgroundSender(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    !sender.tab &&
    (!sender.url || sender.url === chrome.runtime.getURL('background.js'))
  );
}
export function sourcePage(sender: chrome.runtime.MessageSender): string {
  if (
    sender.id !== chrome.runtime.id ||
    sender.tab?.id === undefined ||
    sender.frameId !== 0 ||
    !sender.url ||
    !/^https?:/.test(sender.url) ||
    !sender.tab.url ||
    !/^https?:/.test(sender.tab.url) ||
    new URL(sender.tab.url).origin !== new URL(sender.url).origin
  )
    throw new Error('Reading requests require a source page');
  // Chrome keeps sender.url at the document's initial URL after pushState.
  // The browser-supplied main-frame tab URL tracks its current route.
  return sender.tab.url;
}
