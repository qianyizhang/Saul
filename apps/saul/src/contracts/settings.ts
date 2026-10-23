import type { UserSettings } from '../types';
import { record } from './reading';

export type SettingsRequest =
  | { action: 'read' }
  | { action: 'commit'; baseline: string; settings: unknown }
  | { action: 'reset'; baseline: string };

export type SettingsState =
  | { state: 'ready'; revision: string; settings: UserSettings; reset?: boolean }
  | { state: 'invalid'; revision: string; error: string }
  | { state: 'conflict'; error: string };

export function validateSettingsRequest(value: unknown): asserts value is SettingsRequest {
  if (!record(value)) throw new Error('Invalid settings request');
  const keys = Object.keys(value);
  if (value.action === 'read' && keys.length === 1) return;
  if (typeof value.baseline !== 'string' || !/^[a-f0-9]{64}$/.test(value.baseline))
    throw new Error('Invalid settings revision');
  if (value.action === 'reset' && keys.length === 2) return;
  if (
    value.action === 'commit' &&
    keys.length === 3 &&
    record(value.settings) &&
    typeof value.settings.activeProvider === 'string' &&
    record(value.settings.openaiCompatible) &&
    record(value.settings.chromeAi) &&
    record(value.settings.contextPolicy) &&
    record(value.settings.configuration)
  )
    return;
  throw new Error('Invalid settings request');
}
