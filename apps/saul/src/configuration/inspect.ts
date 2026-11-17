import type { ModelPreset } from '../../shared/model/presets.ts';
import type { Configuration, ProviderDefaults } from './definition';

/** An editable view of one choice. It is neither saved configuration nor permission to run. */
export interface PresetInspection extends ProviderDefaults {
  preset?: ModelPreset;
  issue?: string;
}

export function inspectPreset(settings: Configuration, preset?: ModelPreset): PresetInspection {
  if (!preset)
    return {
      provider: settings.activeProvider,
      profileId: settings.activeProfileId,
      remote: structuredClone(settings.openaiCompatible),
      plan: structuredClone(settings.chatgptPlan),
      local: structuredClone(settings.chromeAi),
    };
  const connection = settings.connections.find((c) => c.key === preset.connectionKey);
  let issue: string | undefined;
  if (preset.connectionKey && !connection)
    issue = `Connection “${preset.connectionKey}” is unavailable. Open Connections.`;
  else if (
    connection &&
    (connection.kind === 'chatgpt-plan' ? 'chatgpt-plan' : 'openai-compatible') !== preset.provider
  )
    issue = 'The preset connection changed. Reload settings before running.';
  const profileId = preset.connectionKey
    ? settings.connectionProfiles?.[preset.connectionKey] || preset.profileId
    : preset.profileId;
  const profile = settings.profiles?.find((p) => p.id === profileId);
  const managed =
    connection?.kind === 'openai-api' &&
    settings.sharedCredentials === 'saul' &&
    connection.baseUrl;
  const implicit = !settings.profiles && profileId === (settings.activeProfileId || 'default');
  const source = managed
    ? {
        baseUrl: connection.baseUrl!,
        apiKey: '',
        credentialOwner: 'saul' as const,
        model: preset.model,
        temperature: preset.temperature ?? 0.3,
      }
    : (profile?.config ?? (implicit ? settings.openaiCompatible : undefined));
  if (preset.provider === 'openai-compatible' && !source)
    issue ??= `Preset “${preset.name}” needs its saved connection. Choose a connection in Settings.`;
  return {
    preset: structuredClone(preset),
    provider: preset.provider,
    profileId: managed ? connection.key : profileId,
    remote:
      preset.provider !== 'openai-compatible'
        ? structuredClone(settings.openaiCompatible)
        : {
            ...(source ?? { baseUrl: '', apiKey: '', temperature: 0.3 }),
            model: preset.model,
            temperature: preset.temperature ?? source?.temperature ?? 0.3,
          },
    plan:
      preset.provider !== 'chatgpt-plan'
        ? structuredClone(settings.chatgptPlan)
        : {
            accountId: connection?.accountId ?? settings.chatgptPlan?.accountId ?? '',
            model: preset.model,
            ...(preset.effort === undefined ? {} : { effort: preset.effort }),
            ...(preset.fast === undefined ? {} : { fast: preset.fast }),
          },
    local:
      preset.provider !== 'chrome-ai'
        ? structuredClone(settings.chromeAi)
        : {
            temperature: preset.temperature ?? settings.chromeAi.temperature,
            topK: preset.topK ?? settings.chromeAi.topK,
          },
    ...(issue ? { issue } : {}),
  };
}
