import {
  validConnectionToken,
  type SetupFence,
} from '../../shared/protocol/connection-coordination.mts';
import type { ConnectionDefinition } from '../../shared/protocol/shared-presets-contract.mts';
import { requestSettings } from '../configuration/client';
import { connectionDefinition } from '../configuration/connections';
import { credentialCall } from '../native/credentials';
import {
  ConnectionSetupNotAdmitted,
  connectionSetupLock,
  sameDefinition,
  requireConnectionCoordination,
  type ConnectionSetup,
} from './setup';
import { isRecord } from '../../shared/model/value.mts';
import {
  CONNECTION_TARGET,
  CONNECTION_REVIEW_PORT,
  type ConnectionReviewRequest,
  type ConnectionRequest,
  type ConnectionReply,
  type ConnectionResult,
} from './messages';

export type CommitSetup = (setup: ConnectionSetup, key: string, review: boolean) => Promise<void>;

export async function requestConnection<T extends ConnectionRequest>(
  message: T,
): Promise<ConnectionResult<T['action']>> {
  const reply: ConnectionReply<T['action']> | undefined = await chrome.runtime.sendMessage({
    target: CONNECTION_TARGET,
    message,
  });
  if (!reply?.success) {
    if (reply?.setupNotAdmitted) throw new ConnectionSetupNotAdmitted(reply.error);
    throw new Error(reply?.error ?? 'Connection setup was interrupted. Review the current setup.');
  }
  return reply.result;
}

export const saveSetup = (setup: ConnectionSetup, key: string, resume: boolean) =>
  requestConnection({
    action: 'save',
    setup: {
      ...setup,
      definition: connectionDefinition(setup.definition),
      ...(setup.previous && { previous: connectionDefinition(setup.previous) }),
    },
    key,
    resume,
  });
export const discardConnectionSetup = (id: string, phase: ConnectionSetup['phase']) =>
  requestConnection({ action: 'discard', id, phase });
export const connectionRecovery = () => requestConnection({ action: 'recovery' });
export const connectionAccounts = () => requestConnection({ action: 'accounts' });
export const connectionSetups = () => requestConnection({ action: 'setups' });
export const releaseSetup = (fence: SetupFence) => requestConnection({ action: 'release', fence });

async function currentConnections() {
  const latest = await requestSettings({ action: 'read' });
  if (latest.state !== 'ready') throw new Error(latest.error);
  if (latest.settings.sharedCredentials !== 'saul')
    throw new Error('Connect to Saul before changing credentials.');
  return latest.settings.connections;
}

export async function changeOutsideSetup(
  key: string,
  previous: ConnectionDefinition | undefined,
  work: () => Promise<void>,
  accountId?: string,
  signal?: AbortSignal,
) {
  await navigator.locks.request(connectionSetupLock(key), { signal }, async () => {
    if ((await connectionRecovery()).some((record) => record.definition.key === key))
      throw new Error('Finish or discard the setup for this connection first.');
    const latest = await currentConnections();
    if (
      !sameDefinition(
        latest.find((c) => c.key === key),
        previous,
      )
    )
      throw new Error('This connection changed. Review the saved connection before continuing.');
    if (accountId && latest.some((c) => c.key !== key && c.accountId === accountId))
      throw new Error('This account already has a connection.');
    await requireConnectionCoordination(credentialCall);
    signal?.throwIfAborted();
    await work();
  });
}

export async function withReviewedConnectionSetup(
  setup: ConnectionSetup,
  work: (setupToken: string, signal: AbortSignal) => Promise<void>,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const port = chrome.runtime.connect({ name: CONNECTION_REVIEW_PORT });
  const lifetime = new AbortController();
  const ready = Promise.withResolvers<string>();
  const stop = (error: unknown) => {
    ready.reject(error);
    lifetime.abort(error);
  };
  const cancel = () => stop(signal?.reason ?? new DOMException('Stopped', 'AbortError'));
  signal?.addEventListener('abort', cancel, { once: true });
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    stop(new Error('Connection protection ended. Review the current setup.'));
  });
  port.onMessage.addListener((reply: unknown) => {
    if (isRecord(reply) && validConnectionToken(reply.token)) ready.resolve(reply.token);
    else
      stop(
        new Error(
          isRecord(reply) && typeof reply.error === 'string'
            ? reply.error
            : 'Invalid connection setup response.',
        ),
      );
  });
  const deadline = setTimeout(() => stop(new Error('Connection setup review timed out.')), 20_000);
  try {
    port.postMessage({
      key: setup.definition.key,
      id: setup.id,
      phase: setup.phase,
    } satisfies ConnectionReviewRequest);
    const token = await ready.promise;
    clearTimeout(deadline);
    lifetime.signal.throwIfAborted();
    await work(token, lifetime.signal);
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', cancel);
    port.disconnect();
  }
}
