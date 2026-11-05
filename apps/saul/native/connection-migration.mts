import { isRecord } from './value.mts';
import { DEFAULT_CONNECTIONS } from './shared-presets-contract.mts';

// Storage upgrade only. Current interfaces never accept the old field names.
function rename(value: Record<string, unknown>, from: string, to: string): void {
  if (!Object.hasOwn(value, from)) return;
  if (Object.hasOwn(value, to))
    throw new Error(`Conflicting ${from}/${to} fields. Original data preserved.`);
  value[to] = value[from];
  delete value[from];
}
function preset(value: unknown): void {
  if (isRecord(value)) rename(value, 'providerKey', 'connectionKey');
}
function configuration(value: unknown): void {
  if (!isRecord(value)) return;
  rename(value, 'providers', 'connections');
  if (Array.isArray(value.presets)) value.presets.forEach(preset);
}
function settings(value: unknown): void {
  if (!isRecord(value)) return;
  rename(value, 'providers', 'connections');
  rename(value, 'providerConnections', 'connectionProfiles');
  configuration(value.configuration);
}
export function upgradeConnectionSettings(source: unknown): unknown {
  const value: unknown = structuredClone(source);
  settings(value);
  return value;
}
export function upgradeConnectionDocument(
  source: Record<string, unknown>,
): Record<string, unknown> {
  const value = structuredClone(source);
  if (value.apps !== undefined && !isRecord(value.apps))
    throw new Error('Invalid app settings. Original file preserved.');
  const apps = isRecord(value.apps) ? value.apps : {};
  const ez = isRecord(apps.ez) ? apps.ez : {};
  const scope = isRecord(ez.configuration) ? ez.configuration : {};
  configuration(scope.value);
  const saul = isRecord(apps.saul) ? apps.saul : {};
  if (isRecord(saul.settings)) settings(saul.settings.value);
  if (isRecord(value.modelPresets)) {
    configuration(value.modelPresets);
    if (value.modelPresets.connections === undefined)
      value.modelPresets.connections =
        isRecord(scope.value) && scope.value.connections !== undefined
          ? scope.value.connections
          : structuredClone(DEFAULT_CONNECTIONS);
  } else if (
    value.modelPresets === undefined &&
    isRecord(scope.value) &&
    scope.value.connections !== undefined
  ) {
    value.modelPresets = { revision: 0, presets: [], connections: scope.value.connections };
  }
  return value;
}
export function upgradeRunConnections(source: Record<string, unknown>): Record<string, unknown> {
  const value = structuredClone(source);
  preset(value.preset);
  return value;
}
export function upgradeNativeHistoryConnections(
  source: Record<string, unknown>,
): Record<string, unknown> {
  const value = structuredClone(source);
  rename(value, 'providerSnapshot', 'connectionSnapshot');
  preset(value.presetSnapshot);
  return value;
}
