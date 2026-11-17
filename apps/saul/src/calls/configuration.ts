import type { Configuration } from '../configuration/definition';
import { configurationFor } from '../configuration/definition';
import { preparePreset } from '../configuration/resolve';

export function prepareCallModel(settings: Configuration, presetId: string) {
  const preset = configurationFor(settings).presets.find((p) => p.id === presetId);
  if (!preset) throw new Error('Choose an existing saved preset in Settings → Calls.');
  return preparePreset(settings, preset, 'write');
}
