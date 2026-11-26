import { isRecord } from '../../shared/model/value.mts';
import {
  validConnectionKey,
  validSetupFence,
} from '../../shared/protocol/connection-coordination.mts';
import { validateConnections } from '../../shared/protocol/shared-presets-contract.mts';
import { validSuggestedAppName } from '../../shared/protocol/credential-plan.mts';
import { requireConnectionSettings } from '../native/config-transport';
import { workspaceSender } from '../platform/chrome/sender';
import { nativeCredentialCall } from '../native/credentials';
import type { SettingsState } from '../settings/contract';
import { holdConnection } from './credential-hold';
import {
  ConnectionSetupCoordinator,
  connectionSetupLock,
  holdReviewedSetup,
  listConnectionSetups,
  readConnectionSetup,
  readConnectionSetups,
  releaseConnectionSetup,
  requireConnectionCoordination,
  setupConnections,
} from './setup';

export function createConnectionService(settings: (request: unknown) => Promise<SettingsState>) {
  async function readSettings() {
    const result = await settings({ action: 'read' });
    if (result.state !== 'ready') throw new Error(result.error);
    if (result.settings.sharedCredentials !== 'saul')
      throw new Error('Connect to Saul before managing shared connections.');
    return result;
  }
  const setup = () =>
    new ConnectionSetupCoordinator({
      readSettings,
      async commit(latest, connections, setupFence) {
        const result = await settings({
          action: 'commit',
          baseline: latest.revision,
          settings: { ...latest.settings, connections },
          setupFence,
        });
        if (result.state !== 'ready') throw new Error(result.error);
        return result;
      },
      requireSettingsWriter: requireConnectionSettings,
      credential: nativeCredentialCall,
      hold: (request, signal) => holdConnection(request, signal, true),
    });

  async function request(message: unknown) {
    if (isRecord(message)) {
      if (message.action === 'recovery') return readConnectionSetups();
      if (message.action === 'accounts') return nativeCredentialCall({ action: 'accounts' });
      if (message.action === 'setups') return listConnectionSetups(nativeCredentialCall);
      if (message.action === 'release' && validSetupFence(message.fence))
        return releaseConnectionSetup(nativeCredentialCall, message.fence);
      if (
        message.action === 'discard' &&
        typeof message.id === 'string' &&
        (message.phase === 'credential' || message.phase === 'settings')
      )
        return setup().discard(message.id, message.phase);
      if (
        message.action === 'save' &&
        typeof message.key === 'string' &&
        typeof message.resume === 'boolean' &&
        isRecord(message.setup)
      ) {
        const draft = message.setup;
        const definitions = [draft.definition];
        const previous = draft.previous === undefined ? [] : [draft.previous];
        validateConnections(definitions);
        validateConnections(previous);
        if (
          typeof draft.id === 'string' &&
          draft.id.length > 0 &&
          draft.id.length <= 128 &&
          (draft.phase === 'credential' || draft.phase === 'settings') &&
          (draft.confirmedName === undefined || validSuggestedAppName(draft.confirmedName))
        ) {
          return setup().save(
            {
              id: draft.id,
              phase: draft.phase,
              definition: definitions[0]!,
              ...(previous[0] && { previous: previous[0] }),
              ...(draft.confirmedName !== undefined && { confirmedName: draft.confirmedName }),
            },
            message.key,
            message.resume,
          );
        }
      }
    }
    throw new Error('Invalid connection setup request.');
  }
  function registerReviewPort() {
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== 'saul-connection-review') return;
      if (!port.sender || !workspaceSender(port.sender)) {
        port.disconnect();
        return;
      }
      const closed = new AbortController();
      port.onDisconnect.addListener(() => closed.abort());
      let active = false;
      const post = (value: unknown) => {
        if (closed.signal.aborted) return;
        try {
          port.postMessage(value);
        } catch {
          closed.abort();
        }
      };
      port.onMessage.addListener((message: unknown) => {
        if (active) return;
        active = true;
        if (
          !isRecord(message) ||
          !validConnectionKey(message.key) ||
          typeof message.id !== 'string' ||
          (message.phase !== 'credential' && message.phase !== 'settings')
        ) {
          post({ error: 'Invalid setup review.' });
          return;
        }
        const { key, id, phase } = message;
        void navigator.locks
          .request(connectionSetupLock(key), { signal: closed.signal }, async () => {
            const pending = await readConnectionSetup(key);
            if (!pending || pending.id !== id || pending.phase !== phase)
              throw new Error('Connection setup changed. Reopen Connections to review it.');
            setupConnections(
              (await readSettings()).settings.connections,
              pending,
              phase === 'settings',
            );
            await requireConnectionCoordination(nativeCredentialCall);
            const { held } = await holdReviewedSetup(
              pending,
              pending,
              {
                credential: nativeCredentialCall,
                hold: (request, signal) => holdConnection(request, signal, true),
              },
              closed.signal,
            );
            try {
              post({ token: held.evidence.token });
              const stop = AbortSignal.any([held.signal, closed.signal]);
              if (!stop.aborted)
                await new Promise<void>((resolve) => {
                  stop.addEventListener('abort', () => resolve(), { once: true });
                });
              if (!closed.signal.aborted)
                post({ error: 'Connection protection ended. Review the current setup.' });
            } finally {
              await held.close();
            }
          })
          .catch((error: unknown) => {
            post({
              error:
                error instanceof Error ? error.message : 'Connection setup could not continue.',
            });
          });
      });
    });
  }
  return { request, registerReviewPort };
}
