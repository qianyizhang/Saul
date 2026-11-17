import { validateHistoryRequest, type HistoryRequest } from './history-protocol.mts';
import { isRecord } from '../model/value.mts';
import {
  validScopedConfig,
  validateScopedConfigValue,
  type ScopedConfig,
  validateSharedPresets,
  validateConnections,
  type ConnectionDefinition,
  type SharedPreset,
  type SharedPresets,
} from './shared-presets-contract.mts';
export type StorageHelperRequest =
  | { action: 'history'; request: HistoryRequest }
  | { action: 'config-read'; section: 'settings' | 'calls' }
  | {
      action: 'config-save';
      section: 'settings' | 'calls';
      revision: number;
      value: Record<string, unknown>;
    }
  | { action: 'presets-read' }
  | {
      action: 'config-commit';
      section: 'settings';
      revision: number;
      value: Record<string, unknown>;
      presetRevision: number;
      presets: SharedPreset[];
      connections?: ConnectionDefinition[];
    }
  | { action: 'presets-import'; presets: SharedPreset[] }
  | {
      action: 'presets-save';
      revision: number;
      presets: SharedPreset[];
      connections?: ConnectionDefinition[];
    };
export interface StorageResults {
  history: { value: unknown };
  'config-read': { config: ScopedConfig };
  'config-save': { config: ScopedConfig };
  'config-commit': { config: ScopedConfig; library: SharedPresets };
  'presets-read': { library: SharedPresets };
  'presets-import': { library: SharedPresets };
  'presets-save': { library: SharedPresets };
}
export type StorageResult<T extends StorageHelperRequest = StorageHelperRequest> = {
  type: 'result';
} & StorageResults[T['action']];
export type StorageEvent = StorageResult | { type: 'error'; message: string };

export const STORAGE_HOST = 'com.saul.chatgpt'; // Stable installed identity.
export const STORAGE_PORT = 'saul-chatgpt';
export function validateStorageHelperRequest(v: unknown): asserts v is StorageHelperRequest {
  if (!isRecord(v)) throw new Error('Invalid storage request');
  if (['accounts', 'login', 'logout', 'models', 'generate'].some((action) => action === v.action))
    throw new Error(
      'Standalone ChatGPT sign-in has retired. Connect to the signed Saul helper in Settings.',
    );
  const operations: Record<StorageHelperRequest['action'], string[]> = {
    history: ['request'],
    'config-read': ['section'],
    'config-save': ['section', 'revision', 'value'],
    'config-commit': ['section', 'revision', 'value', 'presetRevision', 'presets', 'connections'],
    'presets-read': [],
    'presets-import': ['presets'],
    'presets-save': ['revision', 'presets', 'connections'],
  };
  const keys =
    typeof v.action === 'string' && Object.hasOwn(operations, v.action)
      ? operations[v.action as StorageHelperRequest['action']]
      : undefined;
  if (!keys || Object.keys(v).some((k) => k !== 'action' && !keys.includes(k)))
    throw new Error('Unsupported storage operation');
  if (v.action === 'history') {
    validateHistoryRequest(v.request);
    return;
  }
  if (v.action === 'config-commit') {
    if (
      v.section !== 'settings' ||
      !validScopedConfig(v) ||
      !Number.isSafeInteger(v.presetRevision) ||
      Number(v.presetRevision) < 0
    )
      throw new Error('Invalid configuration transaction.');
    validateScopedConfigValue(v.value);
    validateSharedPresets(v.presets);
    if (v.connections !== undefined) validateConnections(v.connections);
    return;
  }
  if (v.action === 'config-read' || v.action === 'config-save') {
    if (v.section !== 'settings' && v.section !== 'calls')
      throw new Error('Invalid config section.');
    if (v.action === 'config-save') {
      if (!validScopedConfig(v)) throw new Error('Invalid config revision.');
      validateScopedConfigValue(v.value);
    }
    return;
  }
  if (v.action === 'presets-read') return;
  if (v.action === 'presets-import' || v.action === 'presets-save') {
    validateSharedPresets(v.presets);
    if (v.connections !== undefined) validateConnections(v.connections);
    if (
      v.action === 'presets-save' &&
      (!Number.isSafeInteger(v.revision) || Number(v.revision) < 0)
    )
      throw new Error('Invalid shared preset revision.');
    return;
  }
}
const record = isRecord;
export function validateStorageResult<T extends StorageHelperRequest>(
  request: T,
  value: unknown,
): asserts value is StorageResult<T> {
  const validators: Record<
    StorageHelperRequest['action'],
    (v: Record<string, unknown>) => boolean
  > = {
    history: (v) => Object.hasOwn(v, 'value'),
    'config-read': (v) => validScopedConfig(v.config),
    'config-save': (v) => validScopedConfig(v.config),
    'config-commit': (v) => validScopedConfig(v.config) && sharedLibrary(v),
    'presets-read': sharedLibrary,
    'presets-import': sharedLibrary,
    'presets-save': sharedLibrary,
  };
  if (
    !record(value) ||
    value.type !== 'result' ||
    !Object.hasOwn(validators, request.action) ||
    !validators[request.action](value)
  )
    throw new Error('Saul storage helper returned an invalid reply. Update the helper and retry.');
}

function sharedLibrary(value: Record<string, unknown>): boolean {
  if (
    !record(value.library) ||
    !Number.isSafeInteger(value.library.revision) ||
    Number(value.library.revision) < 0
  )
    return false;
  try {
    validateSharedPresets(value.library.presets);
    validateConnections(value.library.connections);
    return true;
  } catch {
    return false;
  }
}
