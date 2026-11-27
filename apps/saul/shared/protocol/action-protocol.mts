import { operationSchema, type AnnotationOperation } from './annotations.ts';
import { isRecord } from '../model/value.mts';

export const ACTION_HOST = 'com.saul.actions';
export const ACTION_PORT = 'saul-actions';
export const ACTION_VERSION = 1;
export const ACTION_MAX_CALLS = 3;
export const ACTION_TIMEOUT_MS = 300_000;
export const ACTION_IDLE_MS = 60_000;
export const ACTION_MAX_TEXT = 60_000;
export interface ActionModule {
  contractVersion: 1;
  name: string;
  description: string;
  language: 'javascript' | 'typescript';
  source: string;
}
export interface ActionRevision extends ActionModule {
  revision: string;
  createdAt: number;
  approved?: boolean;
}
export interface ActionSource {
  title: string;
  url: string;
  coverage: string;
  text?: string;
  pdfUrl?: string;
  annotations?: { id: string; comment: string; evidence: string }[];
}
export interface ActionGenerate {
  instructions: string;
  input?: string;
}
export type ActionHostRequest =
  | { action: 'stage'; module: ActionModule }
  | { action: 'file'; path: string }
  | { action: 'load'; revision: string }
  | { action: 'run'; revision: string; source: ActionSource }
  | { action: 'prune'; protect: string[] };
export type ActionHostEvent =
  | { type: 'result'; revision?: ActionRevision; text?: string }
  | { type: 'error'; message: string }
  | { type: 'progress'; text: string }
  | { type: 'generate'; callId: number; request: ActionGenerate }
  | { type: 'annotation'; callId: number; operation: AnnotationOperation };
export type ActionHostResult<T extends ActionHostRequest> = { type: 'result' } & (T extends {
  action: 'run';
}
  ? { text: string; revision?: never }
  : T extends { action: 'prune' }
    ? { revision?: never; text?: never }
    : { revision: ActionRevision; text?: never });
export type ActionCancel = { cancel: true };
export type ActionCallback = { callId: number } & ActionCallbackResult;
export type ActionCallbackResult =
  { text: string; error?: string } | { text?: string; error: string };
export type ActionPortMessage = ActionHostRequest | ActionCancel | ActionCallback;
export type ActionNativeMessage = { id: string } & (
  { request: ActionHostRequest } | ActionCancel | ActionCallback
);
export type ActionNativeEvent = { id: string; event: ActionHostEvent };
export type ActionWorkerMessage = { id: string } & (
  { source: ActionSource } | ActionCancel | ActionCallback
);
export type ActionWorkerEvent =
  | { ready: true }
  | {
      id: string;
      event:
        | Exclude<ActionHostEvent, { type: 'annotation' }>
        | { type: 'annotation'; callId: number; operation: unknown };
    };
export const validateAnnotationOperation = (value: unknown) => operationSchema.parse(value);

export function isActionCallback(value: unknown): value is ActionCallback {
  return (
    isRecord(value) &&
    typeof value.callId === 'number' &&
    Number.isSafeInteger(value.callId) &&
    (value.text === undefined || typeof value.text === 'string') &&
    (value.error === undefined || typeof value.error === 'string') &&
    (typeof value.text === 'string' || typeof value.error === 'string')
  );
}

export function validateActionHostEvent(value: unknown): asserts value is ActionHostEvent {
  if (isRecord(value)) {
    switch (value.type) {
      case 'result':
        if (value.text !== undefined && typeof value.text !== 'string') break;
        if (value.revision !== undefined) {
          if (!isRecord(value.revision)) break;
          const { revision, createdAt, approved, ...module } = value.revision;
          if (
            !validRevision(revision) ||
            typeof createdAt !== 'number' ||
            (approved !== undefined && typeof approved !== 'boolean')
          )
            break;
          validateActionModule(module);
        }
        return;
      case 'error':
        if (typeof value.message === 'string') return;
        break;
      case 'progress':
        if (typeof value.text === 'string') return;
        break;
      case 'generate':
      case 'annotation':
        if (typeof value.callId !== 'number' || !Number.isSafeInteger(value.callId)) break;
        if (value.type === 'generate') validateActionGenerate(value.request);
        else validateAnnotationOperation(value.operation);
        return;
    }
  }
  throw new Error('Action helper returned an invalid event.');
}

export function validateActionHostResult<T extends ActionHostRequest>(
  request: T,
  event: Extract<ActionHostEvent, { type: 'result' }>,
): asserts event is ActionHostResult<T> {
  if (
    request.action === 'run'
      ? typeof event.text === 'string' && event.revision === undefined
      : request.action === 'prune'
        ? event.text === undefined && event.revision === undefined
        : event.revision !== undefined && event.text === undefined
  )
    return;
  throw new Error('Action helper returned a result for a different operation.');
}

export function validRevision(v: unknown): v is string {
  return typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
}
export function validateActionModule(v: unknown): asserts v is ActionModule {
  if (
    !isRecord(v) ||
    v.contractVersion !== ACTION_VERSION ||
    Object.keys(v).some(
      (k) => !['contractVersion', 'name', 'description', 'language', 'source'].includes(k),
    ) ||
    typeof v.name !== 'string' ||
    !v.name.trim() ||
    v.name.length > 80 ||
    typeof v.description !== 'string' ||
    v.description.length > 1000 ||
    (v.language !== 'javascript' && v.language !== 'typescript') ||
    typeof v.source !== 'string' ||
    !v.source.trim() ||
    v.source.length > ACTION_MAX_TEXT
  )
    throw new Error(
      'Expected action contract 1 with name, description, language and one self-contained source module.',
    );
}
export function validateActionGenerate(v: unknown): asserts v is ActionGenerate {
  if (
    !isRecord(v) ||
    Object.keys(v).some((k) => !['instructions', 'input'].includes(k)) ||
    typeof v.instructions !== 'string' ||
    v.instructions.length > 32_768 ||
    (v.input !== undefined && (typeof v.input !== 'string' || v.input.length > 150_000))
  )
    throw new Error(
      'generate accepts only instructions and optional input text. Model choices are frozen by Saul.',
    );
}
export function validateActionHostRequest(v: unknown): asserts v is ActionHostRequest {
  if (!isRecord(v)) throw new Error('Invalid action helper request.');
  const keys: Record<string, string[]> = {
    stage: ['module'],
    file: ['path'],
    load: ['revision'],
    run: ['revision', 'source'],
    prune: ['protect'],
  };
  if (
    typeof v.action !== 'string' ||
    !Object.hasOwn(keys, v.action) ||
    Object.keys(v).some((k) => k !== 'action' && !keys[v.action as string]!.includes(k))
  )
    throw new Error('Invalid action helper request.');
  if (v.action === 'stage') validateActionModule(v.module);
  if (v.action === 'file' && (typeof v.path !== 'string' || !v.path || v.path.length > 4096))
    throw new Error('Choose a local JS or TS file.');
  if (['load', 'run'].includes(v.action) && !validRevision(v.revision))
    throw new Error('Invalid action revision.');
  if (v.action === 'run') validateActionSource(v.source);
  if (
    v.action === 'prune' &&
    (!Array.isArray(v.protect) || v.protect.length > 100_000 || !v.protect.every(validRevision))
  )
    throw new Error('Invalid retained action revisions.');
}

export function validateActionSource(source: unknown): asserts source is ActionSource {
  if (
    !isRecord(source) ||
    !['title', 'url', 'coverage'].every((key) => typeof source[key] === 'string') ||
    (source.annotations !== undefined &&
      (!Array.isArray(source.annotations) ||
        source.annotations.length > 20 ||
        source.annotations.some(
          (a: unknown) =>
            !isRecord(a) ||
            typeof a.id !== 'string' ||
            typeof a.comment !== 'string' ||
            typeof a.evidence !== 'string' ||
            a.evidence.length > 120000,
        ))) ||
    (source.text !== undefined &&
      (typeof source.text !== 'string' || source.text.length > 150_000)) ||
    (source.pdfUrl !== undefined && typeof source.pdfUrl !== 'string')
  )
    throw new Error('Invalid captured action source.');
}
