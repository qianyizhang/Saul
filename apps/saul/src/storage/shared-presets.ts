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
  return reply.event.library;
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
  for (const p of configuration.presets.filter((p) => p.provider === 'chatgpt-plan'))
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
});
const definitions = (settings: UserSettings) =>
  configurationFor(settings)
    .presets.filter((p) => p.provider === 'chatgpt-plan')
    .map(portable);

function project(settings: UserSettings, library: SharedPresets): UserSettings {
  const configuration = configurationFor(settings);
  return {
    ...settings,
    sharedPresetRevision: library.revision,
    configuration: {
      ...configuration,
      presets: [
        ...configuration.presets.filter((p) => p.provider !== 'chatgpt-plan'),
        ...library.presets.map(
          (p): ModelPreset => ({
            ...p,
            id: p.id.toLowerCase(),
            provider: 'chatgpt-plan',
            accountId:
              configuration.presets.find((local) => local.id.toLowerCase() === p.id.toLowerCase())
                ?.accountId ?? '',
          }),
        ),
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
      if (old.length) throw error;
      const local = { ...source };
      delete local.sharedPresetRevision;
      return local;
    }
    if (source.sharedPresetRevision === undefined && old.length) {
      settings = await withSharedIDs(source);
      library = await sharedCall({ action: 'presets-import', presets: definitions(settings) });
    }
    return project(settings, library);
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
    return project(
      settings,
      await sharedCall({
        action: 'presets-save',
        revision: settings.sharedPresetRevision,
        presets,
      }),
    );
  },
};
