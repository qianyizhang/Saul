export const SETTINGS_SECTIONS = [
  ['overview', 'Overview'],
  ['models', 'Presets'],
  ['reading', 'Actions'],
  ['summaries', 'Summaries'],
  ['preferences', 'Preferences'],
  ['connections', 'Providers'],
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number][0];
