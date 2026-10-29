import { isRecord } from './value.mts';

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
  | { type: 'generate'; callId: number; request: ActionGenerate };

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
    !['javascript', 'typescript'].includes(String(v.language)) ||
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
  if (
    v.action === 'run' &&
    (!isRecord(v.source) ||
      !['title', 'url', 'coverage'].every(
        (key) => typeof (v.source as Record<string, unknown>)[key] === 'string',
      ) ||
      (v.source.text !== undefined &&
        (typeof v.source.text !== 'string' || v.source.text.length > 150_000)) ||
      (v.source.pdfUrl !== undefined && typeof v.source.pdfUrl !== 'string'))
  )
    throw new Error('Invalid captured action source.');
  if (
    v.action === 'prune' &&
    (!Array.isArray(v.protect) || v.protect.length > 100_000 || !v.protect.every(validRevision))
  )
    throw new Error('Invalid retained action revisions.');
}
