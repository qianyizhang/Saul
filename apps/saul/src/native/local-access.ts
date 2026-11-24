import { accessLevel, type AccessLevel } from '../../shared/protocol/local-access.mts';

export const localAccessKeys = {
  enabled: 'saul_local_tools_enabled',
  organize: 'saul_local_tools_organize',
  pages: 'saul_local_tools_pages',
  annotations: 'saul_local_tools_annotations',
} as const;

const legacyEnabled = 'saul_native_enabled';
const legacyPages = 'saul_native_page_enabled';
const legacyAnnotations = 'saul_annotation_access';
const accessKeys = [
  ...Object.values(localAccessKeys),
  legacyEnabled,
  legacyPages,
  legacyAnnotations,
];

export function isLocalAccessChange(changes: object) {
  return accessKeys.some((key) => Object.hasOwn(changes, key));
}

export interface LocalAccessPreferences {
  enabled: boolean;
  organize: boolean;
  pages: AccessLevel;
  annotations: AccessLevel;
}

function flag(value: unknown, legacy: unknown) {
  return (value === undefined ? legacy : value) === true;
}

function level(value: unknown, legacy: unknown): AccessLevel {
  if (value === undefined) return legacy === true ? 'write' : 'off';
  return accessLevel.safeParse(value).data ?? 'off';
}

export async function readLocalAccess(): Promise<LocalAccessPreferences> {
  const saved = await chrome.storage.local.get(accessKeys);
  return {
    enabled: flag(saved[localAccessKeys.enabled], saved[legacyEnabled]),
    organize: flag(saved[localAccessKeys.organize], saved[legacyEnabled]),
    pages: level(saved[localAccessKeys.pages], saved[legacyPages]),
    annotations: level(saved[localAccessKeys.annotations], saved[legacyAnnotations]),
  };
}
