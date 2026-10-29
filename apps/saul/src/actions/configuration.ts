import type { UserSettings } from '../types';
import { configurationFor, settingsForPreset } from '../models/configuration';
import { prepareFrozenRun } from '../reading/configuration';
import type { RunInput } from '../types/storage';

export function prepareActionPreset(settings: UserSettings, presetId: string, inspectOnly = false) {
  const preset = configurationFor(settings).presets.find((p) => p.id === presetId);
  if (!preset)
    throw new Error('The action needs an existing saved preset. Choose one in Settings.');
  const selected = settingsForPreset(settings, preset);
  const remote = {
    baseUrl: selected.openaiCompatible.baseUrl,
    model: selected.openaiCompatible.model,
    temperature: selected.openaiCompatible.temperature,
  };
  const input: RunInput = {
    provider: selected.activeProvider,
    remote,
    local: structuredClone(selected.chromeAi),
    ...(selected.activeProvider === 'chatgpt-plan'
      ? { plan: structuredClone(selected.chatgptPlan) }
      : {}),
    preset: structuredClone(preset),
    systemPrompt: '',
    userPrompt: '',
    context: { selection: '', pageTitle: '', pageUrl: '' },
  };
  return inspectOnly ? { input, credential: '' } : prepareFrozenRun(settings, input);
}
