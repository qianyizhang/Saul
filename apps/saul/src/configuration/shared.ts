import { validateScopedConfigValue } from '../../native/shared-presets-contract.mts';
import { portableSettings, restoreSettings } from './scoped';
import {
  ConfigUnavailableError,
  scopedCall,
  sharedCall,
  commitSharedConfiguration,
} from '../native/config-transport';
import type { Configuration, ModelPreset } from './definition';
import type { SharedPreset, SharedPresets } from '../../native/shared-presets-contract.mts';
import { configurationFor } from './definition';

// Stable migration IDs leave saved attempts untouched and keep recipe references together.
async function sharedID(id: string): Promise<string> {
  if (/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) return id.toLowerCase();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`saul:${id}`));
  const h = [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
async function withSharedIDs(settings: Configuration): Promise<Configuration> {
  const configuration = configurationFor(settings);
  const mapping = new Map<string, string>();
  for (const p of configuration.presets.filter((p) => p.provider === 'chatgpt-plan' || p.shared))
    mapping.set(p.id, await sharedID(p.id));
  return {
    ...settings,
    ...(settings.summaryPresetId && {
      summaryPresetId: mapping.get(settings.summaryPresetId) ?? settings.summaryPresetId,
    }),
    configuration: {
      ...configuration,
      presets: configuration.presets.map((p) => ({ ...p, id: mapping.get(p.id) ?? p.id })),
      recipes: configuration.recipes.map((r) => ({
        ...r,
        presetId: mapping.get(r.presetId) ?? r.presetId,
      })),
    },
  };
}
const portable = (p: ModelPreset): SharedPreset => ({
  id: p.id,
  name: p.name,
  model: p.model,
  effort: p.effort ?? '',
  fast: p.fast ?? false,
  ...(p.connectionKey ? { connectionKey: p.connectionKey } : {}),
  ...(p.capability ? { capability: p.capability } : {}),
  ...(p.imageOptions ? { imageOptions: p.imageOptions } : {}),
  ...(p.speechOptions ? { speechOptions: p.speechOptions } : {}),
});
const definitions = (settings: Configuration) =>
  configurationFor(settings)
    .presets.filter((p) => p.provider === 'chatgpt-plan' || p.shared)
    .map(portable);

function project(settings: Configuration, library: SharedPresets): Configuration {
  const configuration = configurationFor(settings);
  const connections = structuredClone(library.connections);
  const connectionProfiles = { ...settings.connectionProfiles };
  // Adopt only the already-selected official OpenAI connection. Never borrow a key from another endpoint.
  if (
    !connectionProfiles['openai-api'] &&
    settings.openaiCompatible.baseUrl.replace(/\/+$/, '') === 'https://api.openai.com/v1'
  )
    connectionProfiles['openai-api'] = settings.activeProfileId || 'default';
  return {
    ...settings,
    connectionProfiles,
    sharedPresetRevision: library.revision,
    connections,
    configuration: {
      ...configuration,
      presets: [
        ...configuration.presets.filter((p) => p.provider !== 'chatgpt-plan' && !p.shared),
        ...library.presets.map((p): ModelPreset => ({
          ...p,
          id: p.id.toLowerCase(),
          provider:
            !p.connectionKey ||
            connections.find((connection) => connection.key === p.connectionKey)?.kind ===
              'chatgpt-plan'
              ? 'chatgpt-plan'
              : 'openai-compatible',
          ...(p.connectionKey
            ? {
                shared: true,
                profileId:
                  connections.find((connection) => connection.key === p.connectionKey)?.kind ===
                  'chatgpt-plan'
                    ? undefined
                    : connectionProfiles[p.connectionKey] || p.connectionKey,
              }
            : {}),
        })),
      ],
    },
  };
}
export const sharedPresets = {
  async load(source: Configuration): Promise<Configuration> {
    let settings = source;
    const old = definitions(source);
    let library: SharedPresets;
    try {
      library = await sharedCall({ action: 'presets-read' });
    } catch (error) {
      // An API-only installation with no shared presets needs no native helper.
      if (
        !(error instanceof ConfigUnavailableError) ||
        old.length ||
        source.scopedConfigRevision !== undefined
      )
        throw error;
      const local = { ...source };
      delete local.sharedPresetRevision;
      return local;
    }
    if (source.sharedPresetRevision === undefined && old.length) {
      settings = await withSharedIDs(source);
      library = await sharedCall({ action: 'presets-import', presets: definitions(settings) });
    }
    const projected = project(settings, library);
    const config = await scopedCall({ action: 'config-read', section: 'settings' });
    if (!config.value) {
      const saved = await scopedCall({
        action: 'config-save',
        section: 'settings',
        revision: config.revision,
        value: portableSettings(projected),
      });
      return { ...projected, scopedConfigRevision: saved.revision };
    }
    return restoreSettings(projected, config);
  },
  async save(source: Configuration): Promise<Configuration> {
    const settings = await withSharedIDs(source);
    const presets = definitions(settings);
    if (settings.sharedPresetRevision === undefined) {
      if (!presets.length) return settings;
      throw new Error(
        'Reload saved settings to load shared presets before saving ChatGPT choices.',
      );
    }
    if (settings.scopedConfigRevision === undefined)
      throw new Error('Reload settings before saving unified config.');
    validateScopedConfigValue(portableSettings(settings));
    const request = {
      action: 'config-commit',
      section: 'settings',
      revision: settings.scopedConfigRevision,
      presetRevision: settings.sharedPresetRevision,
      presets,
      connections: settings.connections,
      value: portableSettings(settings),
    } as const;
    const result = await commitSharedConfiguration(request);
    const projected = project(settings, result.library);
    return { ...projected, scopedConfigRevision: result.config.revision };
  },
};
