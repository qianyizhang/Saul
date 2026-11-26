import { configurationFor, type Configuration } from '../configuration/definition';
import { preparePreset } from '../configuration/resolver';

export function legacySummaryPreset(settings: Configuration): string | undefined {
  // Retain the exact saved ID even if its preset has since been removed or changed.
  if (settings.summaryPresetId) return settings.summaryPresetId;
  if (settings.sharedCredentials !== 'saul' || !settings.summaryConnectionKey) return;
  const connection = settings.connections.find(
    (candidate) => candidate.key === settings.summaryConnectionKey,
  );
  if (connection?.kind !== 'chatgpt-plan' || !connection.accountId) return;
  const matches = configurationFor(settings).presets.filter(
    (preset) =>
      preset.connectionKey === connection.key &&
      preset.provider === 'chatgpt-plan' &&
      (preset.capability ?? 'write') === 'write' &&
      preset.model === 'gpt-6-luna' &&
      preset.effort === 'medium' &&
      !preset.fast,
  );
  const [preset] = matches;
  if (!preset || matches.length !== 1) return;
  try {
    const { choices } = preparePreset(settings, preset);
    if (choices.plan?.accountId === connection.accountId) return preset.id;
  } catch {
    // A legacy binding that can no longer resolve needs an explicit choice.
  }
}
