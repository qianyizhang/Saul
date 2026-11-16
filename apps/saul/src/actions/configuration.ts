import type { Configuration } from '../configuration/definition';
import { configurationFor } from '../configuration/definition';
import { preparePreset } from '../configuration/resolve';
import type { RunInput } from '../types/storage';

export function prepareActionPreset(
  settings: Configuration,
  presetId: string,
  inspectOnly = false,
) {
  const preset = configurationFor(settings).presets.find((p) => p.id === presetId);
  if (!preset) throw new Error('Choose an existing saved preset in Settings → Calls.');
  const prepared = preparePreset(settings, preset, 'write', inspectOnly);
  const input: RunInput = {
    ...prepared.choices,
    systemPrompt: '',
    userPrompt: '',
    context: { selection: '', pageTitle: '', pageUrl: '' },
  };
  return { input, credential: prepared.credential };
}
