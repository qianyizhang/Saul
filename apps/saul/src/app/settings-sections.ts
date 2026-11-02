export const SETTINGS_SECTIONS = [
  ['overview', 'Overview'],
  ['models', 'Models'],
  ['reading', 'Reading'],
  ['summaries', 'Summaries'],
  ['preferences', 'Preferences'],
  ['connections', 'Connections'],
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number][0];
