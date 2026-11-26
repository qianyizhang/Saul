import { validConnectionStatus } from '../../shared/protocol/connections-contract.mts';
import { isRecord } from '../../shared/model/value.mts';
import {
  validateConnections,
  validateConnectionChanges,
  type ConnectionDefinition,
} from '../../shared/protocol/shared-presets-contract.mts';
import { validSuggestedAppName } from '../../shared/protocol/credential-plan.mts';
import { planCall } from '../providers/chatgpt-plan';
import { connectionDefinition } from '../configuration/connections';
import { requestSettings } from '../configuration/client';
import { credentialCall } from '../native/credentials';

export const connectionSetupKey = 'saul_pending_connection_setup';
/** Public data only. The key supplied to save never enters a recovery record. */
export interface ConnectionSetup {
  id: string;
  definition: ConnectionDefinition;
  previous?: ConnectionDefinition;
  confirmedName?: string;
  phase: 'credential' | 'settings';
}

function sameDefinition(a?: ConnectionDefinition, b?: ConnectionDefinition) {
  return (
    a?.key === b?.key &&
    a?.name === b?.name &&
    a?.kind === b?.kind &&
    a?.accountId === b?.accountId &&
    a?.baseUrl === b?.baseUrl
  );
}

function matchesReviewedSetup(current: ConnectionSetup | undefined, reviewed: ConnectionSetup) {
  return (
    current?.id === reviewed.id &&
    current.phase === reviewed.phase &&
    sameDefinition(current.definition, reviewed.definition) &&
    sameDefinition(current.previous, reviewed.previous) &&
    current.confirmedName === reviewed.confirmedName
  );
}

export function setupConnections(
  current: ConnectionDefinition[],
  setup: ConnectionSetup,
  allowApplied = true,
) {
  const next = setup.definition;
  const existing = current.find((c) => c.key === next.key);
  if (allowApplied && sameDefinition(existing, next)) return current;
  if (!sameDefinition(existing, setup.previous))
    throw new Error(
      'This connection changed. Review the saved connection before starting setup again.',
    );
  if (next.accountId && current.some((c) => c.key !== next.key && c.accountId === next.accountId))
    throw new Error('This account already has a connection.');
  const updated = existing
    ? current.map((c) => (c.key === next.key ? next : c))
    : [...current, next];
  validateConnectionChanges(current, updated);
  validateConnections(updated);
  return updated;
}

export async function readConnectionSetup(): Promise<ConnectionSetup | undefined> {
  const value: unknown = (await chrome.storage.local.get(connectionSetupKey))[connectionSetupKey];
  if (value === undefined) return;
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !value.id ||
    (value.phase !== 'credential' && value.phase !== 'settings') ||
    (value.confirmedName !== undefined && !validSuggestedAppName(value.confirmedName))
  )
    throw new Error('The unfinished connection setup could not be read.');
  const definitions = [value.definition];
  validateConnections(definitions);
  const previous = value.previous === undefined ? [] : [value.previous];
  validateConnections(previous);
  return {
    id: value.id,
    phase: value.phase,
    definition: definitions[0]!,
    previous: previous[0],
    ...(value.confirmedName !== undefined && { confirmedName: value.confirmedName }),
  };
}

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
  await navigator.locks.request(connectionSetupKey, { signal }, async () => {
    if ((await readConnectionSetup())?.definition.key === key)
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
    signal?.throwIfAborted();
    await work();
  });
}

/** Keep a reviewed recovery action and discard ordered across extension windows. */
export async function withReviewedConnectionSetup(
  setup: ConnectionSetup,
  work: () => Promise<void>,
  signal?: AbortSignal,
) {
  await navigator.locks.request(connectionSetupKey, { signal }, async () => {
    const pending = await readConnectionSetup();
    if (!pending || !matchesReviewedSetup(pending, setup))
      throw new Error('Connection setup changed. Reopen Connections to review it.');
    setupConnections(await currentConnections(), pending, pending.phase === 'settings');
    signal?.throwIfAborted();
    await work();
  });
}

async function planAvailable(accountId?: string) {
  const { accounts } = await planCall({ action: 'accounts' }, AbortSignal.timeout(20_000));
  return accounts.some((a) => a.id === accountId && a.signedIn && a.planEnabled);
}

export type CommitSetup = (setup: ConnectionSetup, review: boolean) => Promise<void>;

export async function saveConnectionSetup(
  setup: ConnectionSetup,
  key: string,
  commit: CommitSetup,
  resume: boolean,
  onReceipt?: () => void,
) {
  await navigator.locks.request(connectionSetupKey, async () => {
    const pending = await readConnectionSetup();
    if (resume ? !matchesReviewedSetup(pending, setup) : !!pending || setup.phase !== 'credential')
      throw new Error('Connection setup changed. Reopen Connections to review it.');
    const attempt = pending ?? {
      id: setup.id,
      phase: setup.phase,
      definition: connectionDefinition(setup.definition),
      ...(setup.previous ? { previous: connectionDefinition(setup.previous) } : {}),
      ...(setup.confirmedName === undefined ? {} : { confirmedName: setup.confirmedName }),
    };
    setupConnections(await currentConnections(), attempt, attempt.phase === 'settings');
    const remember = (record: ConnectionSetup) =>
      chrome.storage.local.set({ [connectionSetupKey]: record });
    if (
      attempt.definition.kind === 'chatgpt-plan' &&
      !(await planAvailable(attempt.definition.accountId))
    )
      throw new Error(
        'Sign in to the original account and allow plan use before finishing this connection.',
      );
    if (!pending) {
      onReceipt?.();
      await remember(attempt);
    }
    if (attempt.phase === 'credential') {
      const c = attempt.definition;
      if (c.kind === 'openai-api') {
        const result = await credentialCall(
          {
            action: 'connection-key-save',
            connectionKey: c.key,
            endpoint: c.baseUrl ?? 'https://api.openai.com/v1',
            key,
          },
          AbortSignal.timeout(20_000),
        );
        if (
          !validConnectionStatus(result.connection) ||
          !result.connection.connected ||
          result.connection.endpoint !== (c.baseUrl ?? 'https://api.openai.com/v1')
        )
          throw new Error('The helper did not confirm the key for this endpoint.');
      } else if (attempt.confirmedName && c.accountId)
        await credentialCall(
          {
            action: 'confirm-app-name',
            accountId: c.accountId,
            suggestedAppName: attempt.confirmedName,
          },
          AbortSignal.timeout(20_000),
        );
      await remember({ ...attempt, phase: 'settings' });
    }
    if (pending?.phase === 'settings' && attempt.definition.kind === 'openai-api') {
      const endpoint = attempt.definition.baseUrl ?? 'https://api.openai.com/v1';
      const result = await credentialCall(
        { action: 'connection-key-status', connectionKey: attempt.definition.key, endpoint },
        AbortSignal.timeout(20_000),
      );
      if (!validConnectionStatus(result.connection) || result.connection.endpoint !== endpoint)
        throw new Error(
          'The helper could not verify this connection. Check the signed helper before continuing.',
        );
      if (!result.connection.connected) {
        await remember({ ...attempt, phase: 'credential' });
        throw new Error(
          'This key is no longer available. Submit a key for this endpoint to finish setup.',
        );
      }
    }
    await commit(attempt, resume);
    await chrome.storage.local.remove(connectionSetupKey);
  });
}

export async function discardConnectionSetup(id: string, phase: ConnectionSetup['phase']) {
  await navigator.locks.request(connectionSetupKey, async () => {
    const current = await readConnectionSetup();
    if (current?.id !== id || current.phase !== phase)
      throw new Error('Connection setup changed. Reopen Connections to review it.');
    await chrome.storage.local.remove(connectionSetupKey);
  });
}
