import type { Configuration } from '../configuration/definition';
import {
  createSettingsDraft,
  settingsForSave,
  settingsFromDraft,
  type SettingsDraft,
} from './draft';
import { decodeConfiguration } from '../configuration/record';

type Tree = Record<string, unknown>;
export type RecoveryChoice = 'mine' | 'latest';
export interface SettingsChange {
  id: string;
  label: string;
  original: string;
  latest: string;
  mine: string;
  conflict: boolean;
}
export interface SettingsReview {
  changes: SettingsChange[];
  apply(choices: Record<string, RecoveryChoice | undefined>): {
    draft: SettingsDraft;
    dirty: boolean;
  };
}
const object = (value: unknown): value is Tree =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Tree) =>
  Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((value, index) => same(value, b[index]));
  if (!object(a) || !object(b)) return false;
  const left = keys(a),
    right = keys(b);
  return (
    left.length === right.length &&
    left.every((key, index) => key === right[index] && same(a[key], b[key]))
  );
}
const byId = <T extends { id: string }>(items: T[]) =>
  Object.fromEntries(items.map((item) => [item.id, item]));

/** Editable values are explicit; transport defaults and inspection IDs are outside this tree. */
function values(draft: SettingsDraft): Tree {
  const s = draft.values;
  return {
    ...s,
    profiles: byId(s.profiles ?? []),
    connections: Object.fromEntries(s.connections.map((item) => [item.key, item])),
    configuration: s.configuration && {
      ...s.configuration,
      presets: byId(s.configuration.presets),
      recipes: byId(s.configuration.recipes),
    },
  };
}
function at(tree: unknown, path: string[]): unknown {
  return path.reduce<unknown>((value, key) => (object(value) ? value[key] : undefined), tree);
}
function put(tree: Tree, path: string[], value: unknown): void {
  let target = tree;
  for (const key of path.slice(0, -1)) {
    if (!object(target[key])) throw new Error('This item no longer exists. Review it again.');
    target = target[key];
  }
  const key = path.at(-1)!;
  if (value === undefined) delete target[key];
  else
    Object.defineProperty(target, key, {
      value: structuredClone(value),
      enumerable: true,
      configurable: true,
      writable: true,
    });
}
function display(value: unknown, path: string[] = []): string {
  if (path.at(-1) === 'apiKey') return value ? 'Key set (hidden)' : 'No key';
  if (value === undefined) return 'Not present';
  if (typeof value === 'string') return value || '(empty)';
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (object(value))
    return Object.entries(value)
      .filter(([key]) => key !== 'id' && key !== 'key')
      .map(([key, item]) => `${fieldName(key)}: ${display(item, [...path, key])}`)
      .join('\n');
  return String(value);
}
const fieldNames: Record<string, string> = {
  name: 'Name',
  model: 'Model',
  effort: 'Reasoning effort',
  fast: 'Fast',
  apiKey: 'API key',
  baseUrl: 'Endpoint',
  connectionKey: 'Connection',
  profileId: 'API connection',
  presetId: 'Preset',
  selectedRecipeId: 'Default action',
  systemPrompt: 'Instructions',
  template: 'Prompt template',
  planAccountId: 'Plan account',
  config: 'Connection details',
  responseLanguage: 'Response language',
  sharedCredentials: 'Credential owner',
};
function fieldName(key: string): string {
  return (
    fieldNames[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
  );
}
function itemPath(path: string[]): boolean {
  return (
    (path.length === 2 && ['profiles', 'connections'].includes(path[0]!)) ||
    (path.length === 3 && path[0] === 'configuration' && ['presets', 'recipes'].includes(path[1]!))
  );
}
function label(path: string[], trees: Tree[]): string {
  const prefix =
    path[0] === 'configuration' && ['presets', 'recipes'].includes(path[1] ?? '')
      ? 3
      : ['profiles', 'connections'].includes(path[0] ?? '')
        ? 2
        : 0;
  if (!prefix) return path.map(fieldName).join(' · ');
  const item = trees.map((tree) => at(tree, path.slice(0, prefix))).find(object);
  const kind = path[1] === 'presets' ? 'Preset' : path[1] === 'recipes' ? 'Action' : 'Connection';
  return `${kind} “${String(item?.name ?? path[prefix - 1])}”${path.length > prefix ? ' · ' + path.slice(prefix).map(fieldName).join(' · ') : ''}`;
}
function origin(value: unknown): string {
  try {
    return new URL(object(value) ? String(value.baseUrl) : '').origin;
  } catch {
    return '';
  }
}

/** The review closes over snapshots; cancellation never replaces the live draft. */
export function reviewSettings(
  base: SettingsDraft,
  local: SettingsDraft,
  current: Configuration,
): SettingsReview {
  const latest = createSettingsDraft(current),
    mine = structuredClone(local);
  const originalValues = values(base),
    mineValues = values(mine),
    latestValues = values(latest);
  const edits: Array<{ path: string[]; value: unknown; change: SettingsChange }> = [];
  function visit(original: unknown, proposed: unknown, saved: unknown, path: string[]): void {
    if (same(original, proposed) || same(proposed, saved)) return;
    // Endpoint and key travel together when an origin changes. Never combine a key
    // from one side with another side's destination while reconciling fields.
    const credentialRoute =
      path[0] === 'profiles' &&
      path.at(-1) === 'config' &&
      (origin(original) !== origin(proposed) || origin(original) !== origin(saved));
    if (!credentialRoute && object(original) && object(proposed) && object(saved)) {
      for (const key of new Set([...keys(original), ...keys(proposed)]))
        visit(original[key], proposed[key], saved[key], [...path, key]);
      return;
    }
    const removedItem =
      itemPath(path) && original !== undefined && (proposed === undefined || saved === undefined);
    edits.push({
      path,
      value: proposed,
      change: {
        id: JSON.stringify(path),
        label: label(path, [mineValues, latestValues, originalValues]),
        original: display(original, path),
        latest: display(saved, path),
        mine: display(proposed, path),
        conflict: removedItem || !same(original, saved),
      },
    });
  }
  visit(originalValues, mineValues, latestValues, []);
  return {
    changes: edits.map((edit) => edit.change),
    apply(choices) {
      const merged = structuredClone(latestValues);
      for (const { path, value, change } of edits) {
        const choice = choices[change.id] ?? (change.conflict ? undefined : 'mine');
        if (!choice) throw new Error(`Choose Mine or Latest for ${change.label}.`);
        if (choice === 'mine') put(merged, path, value);
      }
      const ordered = (
        value: unknown,
        before: Array<{ id?: string; key?: string }>,
        edited: Array<{ id?: string; key?: string }>,
      ) => {
        if (!object(value))
          throw new Error('Invalid reviewed settings. Your original draft is still here.');
        const ids = new Set([...before, ...edited].map((item) => item.id ?? item.key!));
        return [...ids].filter((id) => Object.hasOwn(value, id)).map((id) => value[id]);
      };
      const config = merged.configuration;
      if (!object(config)) throw new Error('The reviewed configuration is unavailable.');
      const { planAccountId, ...owned } = merged;
      const latestSettings = settingsFromDraft(latest);
      const settings = decodeConfiguration({
        ...latestSettings,
        ...owned,
        chatgptPlan:
          latestSettings.chatgptPlan || planAccountId !== undefined
            ? {
                ...(latestSettings.chatgptPlan ?? { model: '' }),
                accountId: planAccountId,
              }
            : undefined,
        connections: ordered(
          merged.connections,
          latest.values.connections,
          mine.values.connections,
        ),
        profiles: ordered(merged.profiles, latest.values.profiles, mine.values.profiles),
        configuration: {
          ...config,
          presets: ordered(
            config.presets,
            latest.values.configuration.presets,
            mine.values.configuration.presets,
          ),
          recipes: ordered(
            config.recipes,
            latest.values.configuration.recipes,
            mine.values.configuration.recipes,
          ),
        },
      });
      // Preserve the fresh read's defaults and route baseline while applying owned edits.
      const draft = { ...createSettingsDraft(settings, mine), retained: latest.retained };
      settingsForSave(draft);
      return { draft, dirty: !same(values(draft), latestValues) };
    },
  };
}
