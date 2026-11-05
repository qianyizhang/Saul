import { isRecord } from './value.mts';
import type { ActionCapability } from './shared-presets-contract.mts';

export interface ConnectionModel {
  id: string;
  name: string;
  capabilities: ActionCapability[];
  efforts: string[];
  defaultEffort: string;
  fastTier?: string;
}
export interface ConnectionCatalog {
  models: ConnectionModel[];
  fetchedAt: number;
  error?: string;
}
export interface ConnectionStatus {
  connected: boolean;
  identity?: string;
  endpoint?: string;
  keySuffix?: string;
  signedIn?: boolean;
}
export function validConnectionStatus(value: unknown): value is ConnectionStatus {
  return (
    isRecord(value) &&
    typeof value.connected === 'boolean' &&
    Object.keys(value).every((k) =>
      ['connected', 'identity', 'endpoint', 'keySuffix', 'signedIn'].includes(k),
    ) &&
    ['identity', 'endpoint', 'keySuffix'].every(
      (k) =>
        value[k] === undefined ||
        (typeof value[k] === 'string' && value[k].length <= (k === 'keySuffix' ? 4 : 2048)),
    ) &&
    (value.signedIn === undefined || typeof value.signedIn === 'boolean')
  );
}
export function validConnectionCatalog(value: unknown): value is ConnectionCatalog {
  return (
    isRecord(value) &&
    Object.keys(value).every((k) => ['models', 'fetchedAt', 'error'].includes(k)) &&
    typeof value.fetchedAt === 'number' &&
    Number.isFinite(value.fetchedAt) &&
    value.fetchedAt >= 0 &&
    (value.error === undefined ||
      (typeof value.error === 'string' && value.error.length <= 4000)) &&
    Array.isArray(value.models) &&
    value.models.length <= 10_000 &&
    value.models.every(
      (m) =>
        isRecord(m) &&
        Object.keys(m).every((k) =>
          ['id', 'name', 'capabilities', 'efforts', 'defaultEffort', 'fastTier'].includes(k),
        ) &&
        typeof m.id === 'string' &&
        m.id.length > 0 &&
        m.id.length <= 256 &&
        typeof m.name === 'string' &&
        m.name.length > 0 &&
        m.name.length <= 1000 &&
        Array.isArray(m.capabilities) &&
        m.capabilities.every((c) => ['write', 'draw', 'speak'].includes(String(c))) &&
        Array.isArray(m.efforts) &&
        m.efforts.every((e) => typeof e === 'string' && e.length <= 64) &&
        typeof m.defaultEffort === 'string' &&
        m.defaultEffort.length <= 64 &&
        (m.fastTier === undefined || typeof m.fastTier === 'string'),
    ) &&
    new Set(value.models.map((m) => (m as ConnectionModel).id)).size === value.models.length
  );
}
export function catalogIssue(
  catalog: ConnectionCatalog | undefined,
  model: string,
): string | undefined {
  if (!model) return 'Choose a model in Presets.';
  if (!catalog?.fetchedAt) return catalog?.error || 'Loading the connection’s models…';
  if (!catalog.models.some((m) => m.id === model))
    return `Model “${model}” is no longer available. Update this preset in Settings.`;
}
