import {
  connectionCapabilities,
  type ConnectionDefinition,
} from '../../shared/protocol/shared-presets-contract.mts';
import type { ModelPreset } from '../../shared/model/presets.ts';
import { configurationFor, type Configuration } from '../configuration/definition';
import type { SettingsValues } from './draft-storage';

export type ConnectionChange =
  | { action: 'rename'; key: string; name: string }
  | { action: 'move'; key: string; destination: string; presets: string[] }
  | { action: 'delete'; key: string };

export const presetsUsingConnection = (
  settings: Pick<Configuration, 'configuration'>,
  key: string,
) =>
  configurationFor(settings).presets.filter(
    (preset) =>
      (preset.connectionKey ?? (preset.provider === 'chatgpt-plan' ? 'gpt-plan' : '')) === key,
  );

export const presetCountLabel = (count: number) => `${count} ${count === 1 ? 'preset' : 'presets'}`;

export function compatibleDestination(preset: ModelPreset, connection: ConnectionDefinition) {
  return (
    connectionCapabilities(connection).includes(preset.capability ?? 'write') &&
    (connection.kind !== 'chatgpt-plan' ||
      (!!connection.accountId && (preset.shared || preset.provider === 'chatgpt-plan')))
  );
}

export function connectionManagementLabel(connection: ConnectionDefinition) {
  const route =
    connection.kind === 'chatgpt-plan'
      ? 'ChatGPT plan'
      : connection.baseUrl && connection.baseUrl !== 'https://api.openai.com/v1'
        ? connection.baseUrl
        : 'OpenAI API';
  return connection.name === route ? route : `${connection.name} · ${route}`;
}

export function changeConnection(
  settings: SettingsValues,
  change: ConnectionChange,
): SettingsValues {
  const source = settings.connections.find((connection) => connection.key === change.key);
  if (!source) throw new Error('This connection is unavailable. Reload saved settings.');
  if (change.action === 'rename') {
    const connections = settings.connections.map((connection) =>
      connection.key === source.key ? { ...connection, name: change.name.trim() } : connection,
    );
    return { ...settings, connections };
  }

  const linked = presetsUsingConnection(settings, source.key);
  if (change.action === 'delete') {
    if (linked.length)
      throw new Error('Move the presets that use this connection before deleting it.');
    return {
      ...settings,
      connections: settings.connections.filter((connection) => connection.key !== source.key),
    };
  }

  const destination = settings.connections.find(
    (connection) => connection.key === change.destination && connection.key !== source.key,
  );
  const selected = new Set(change.presets);
  const moving = linked.filter((preset) => selected.has(preset.id));
  if (!destination || !moving.length || moving.length !== selected.size)
    throw new Error('Choose a destination and presets that still use this connection.');
  if (!moving.every((preset) => compatibleDestination(preset, destination)))
    throw new Error('The destination must support every selected preset.');
  const { configuration } = settings;
  const plan = destination.kind === 'chatgpt-plan';
  return {
    ...settings,
    configuration: {
      ...configuration,
      presets: configuration.presets.map((preset) =>
        selected.has(preset.id)
          ? {
              ...preset,
              connectionKey: destination.key,
              provider: plan ? 'chatgpt-plan' : 'openai-compatible',
              shared: preset.shared || preset.provider === 'chatgpt-plan',
              profileId: plan ? undefined : (destination.localProfileId ?? destination.key),
            }
          : preset,
      ),
    },
  };
}
