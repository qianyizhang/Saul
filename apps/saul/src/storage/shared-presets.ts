import {
  resolveSharedPresets,
  validateScopedConfigValue,
} from '../../native/shared-presets-contract.mts';
import { scopedCall, portableSettings, restoreSettings } from './scoped-config';
import type { UserSettings, ModelPreset } from '../types';
import type { SharedPreset, SharedPresets } from '../../native/shared-presets-contract.mts';
import {
  PLAN_HOST,
  validatePlanResult,
  type PlanControlRequest,
} from '../../native/plan-protocol.mts';
import { configurationFor } from '../models/configuration';

type PresetRequest = Extract<
  PlanControlRequest,
  { action: 'presets-read' | 'presets-import' | 'presets-save' }
>;
async function sharedCall(request: PresetRequest): Promise<SharedPresets> {
  const reply = await chrome.runtime.sendNativeMessage(PLAN_HOST, {
    id: crypto.randomUUID(),
    request,
  });
  if (reply?.event?.type === 'error') throw new Error(reply.event.message);
  validatePlanResult(request, reply?.event);
  return resolveSharedPresets(reply.event.library);
}

// Stable migration IDs leave saved attempts untouched and keep recipe references together.
async function sharedID(id: string): Promise<string> {
  if (/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) return id.toLowerCase();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`saul:${id}`));
  const h = [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
async function withSharedIDs(settings: UserSettings): Promise<UserSettings> {
  const configuration = configurationFor(settings);
  const mapping = new Map<string, string>();
  for (const p of configuration.presets.filter((p) => p.provider === 'chatgpt-plan' || p.shared))
    mapping.set(p.id, await sharedID(p.id));
  return {
    ...settings,
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
  ...(p.providerKey ? { providerKey: p.providerKey } : {}),
  ...(p.capability ? { capability: p.capability } : {}),
  ...(p.imageOptions ? { imageOptions: p.imageOptions } : {}),
  ...(p.speechOptions ? { speechOptions: p.speechOptions } : {}),
});
const definitions = (settings: UserSettings) =>
  configurationFor(settings)
    .presets.filter((p) => p.provider === 'chatgpt-plan' || p.shared)
    .map(portable);

function project(settings: UserSettings, library: SharedPresets): UserSettings {
  const configuration = configurationFor(settings);
  const providers = structuredClone(library.providers);
  const providerConnections = { ...settings.providerConnections };
  // Adopt only the already-selected official OpenAI connection. Never borrow a key from another endpoint.
  if (
    !providerConnections['openai-api'] &&
    settings.openaiCompatible.baseUrl.replace(/\/+$/, '') === 'https://api.openai.com/v1'
  )
    providerConnections['openai-api'] = settings.activeProfileId || 'default';
  return {
    ...settings,
    providerConnections,
    sharedPresetRevision: library.revision,
    providers,
    configuration: {
      ...configuration,
      presets: [
        ...configuration.presets.filter((p) => p.provider !== 'chatgpt-plan' && !p.shared),
        ...library.presets.map((p): ModelPreset => ({
          ...p,
          id: p.id.toLowerCase(),
          provider:
            !p.providerKey ||
            providers.find((provider) => provider.key === p.providerKey)?.kind === 'chatgpt-plan'
              ? 'chatgpt-plan'
              : 'openai-compatible',
          ...(p.providerKey
            ? {
                shared: true,
                profileId:
                  providers.find((provider) => provider.key === p.providerKey)?.kind ===
                  'chatgpt-plan'
                    ? undefined
                    : providerConnections[p.providerKey] || p.providerKey,
              }
            : {}),
        })),
      ],
    },
  };
}
export const sharedPresets = {
  async load(source: UserSettings): Promise<UserSettings> {
    let settings = source;
    const old = definitions(source);
    let library: SharedPresets;
    try {
      library = await sharedCall({ action: 'presets-read' });
    } catch (error) {
      // An API-only installation with no shared presets needs no native helper.
      if (old.length || source.scopedConfigRevision !== undefined) throw error;
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
  async save(source: UserSettings): Promise<UserSettings> {
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
    const current = await scopedCall({ action: 'config-read', section: 'settings' });
    if (current.revision !== settings.scopedConfigRevision)
      throw new Error('Scoped settings changed. Reload before saving again.');
    validateScopedConfigValue(portableSettings(settings));
    const projected = project(
      settings,
      await sharedCall({
        action: 'presets-save',
        revision: settings.sharedPresetRevision,
        presets,
        providers: settings.providers,
      }),
    );
    const config = await scopedCall({
      action: 'config-save',
      section: 'settings',
      revision: settings.scopedConfigRevision,
      value: portableSettings(projected),
    });
    return { ...projected, scopedConfigRevision: config.revision };
  },
};
