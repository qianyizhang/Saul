export const SETTINGS_SECTIONS = [
  ['overview', 'Overview'],
  ['models', 'Presets'],
  ['reading', 'Actions'],
  ['calls', 'Calls'],
  ['preferences', 'Preferences'],
  ['connections', 'Connections'],
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number][0];
