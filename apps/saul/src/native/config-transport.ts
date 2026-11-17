import { type StorageHelperRequest } from '../../shared/protocol/storage-protocol.mts';
import { StorageConnection, StorageDisconnected } from './storage-connection';
import {
  type SharedPresets,
  type ScopedConfig,
} from '../../shared/protocol/shared-presets-contract.mts';

type Request = Extract<StorageHelperRequest, { action: 'config-read' | 'config-save' }>;
export class ConfigUnavailableError extends Error {}
// Configuration calls run in the service worker, which cannot connect to its
// own extension port. Each call owns its native port until its fully framed reply.
async function configReply<T extends StorageHelperRequest>(request: T) {
  const connection = new StorageConnection();
  try {
    return await connection.request(request);
  } catch (cause) {
    if (cause instanceof StorageDisconnected)
      throw new ConfigUnavailableError('Unified config helper unavailable.', { cause });
    throw cause;
  } finally {
    connection.close();
  }
}
export async function scopedCall(request: Request): Promise<ScopedConfig> {
  const event = await configReply(request);
  return event.config;
}

type PresetRequest = Extract<
  StorageHelperRequest,
  { action: 'presets-read' | 'presets-import' | 'presets-save' }
>;
export async function sharedCall(request: PresetRequest): Promise<SharedPresets> {
  const event = await configReply(request);
  return event.library;
}

export async function commitSharedConfiguration(
  request: Extract<StorageHelperRequest, { action: 'config-commit' }>,
) {
  const event = await configReply(request);
  return { library: event.library, config: event.config };
}
