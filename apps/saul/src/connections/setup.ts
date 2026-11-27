import { validConnectionStatus } from '../../shared/protocol/connections-contract.mts';
import { isRecord } from '../../shared/model/value.mts';
import {
  validateConnections,
  validateConnectionChanges,
  type ConnectionDefinition,
} from '../../shared/protocol/shared-presets-contract.mts';
import {
  validConnectionToken,
  validConnectionReservation,
  type SetupFence,
} from '../../shared/protocol/connection-coordination.mts';
import {
  validPlanAccounts,
  validSuggestedAppName,
} from '../../shared/protocol/credential-plan.mts';
import { connectionDefinition } from '../configuration/connections';
import { CredentialRequestError, type nativeCredentialCall } from '../native/credentials';
import type { holdConnection } from './credential-hold';
import type { SettingsState } from '../settings/contract';

export const legacyConnectionSetupKey = 'saul_pending_connection_setup';
export const connectionSetupKey = 'saul_pending_connection_setups';
export const connectionSetupLock = (key: string) => connectionSetupKey + ':' + key;
/** Public data only. The key supplied to save never enters a recovery record. */
export interface ConnectionSetup {
  id: string;
  definition: ConnectionDefinition;
  previous?: ConnectionDefinition;
  confirmedName?: string;
  phase: 'credential' | 'settings';
  schemaVersion?: 1;
  operationId?: string;
}

export function sameDefinition(a?: ConnectionDefinition, b?: ConnectionDefinition) {
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

function decodeSetup(value: unknown): ConnectionSetup {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !value.id ||
    (value.phase !== 'credential' && value.phase !== 'settings') ||
    (value.confirmedName !== undefined && !validSuggestedAppName(value.confirmedName)) ||
    (value.schemaVersion !== undefined && value.schemaVersion !== 1) ||
    (value.operationId !== undefined && !validConnectionToken(value.operationId))
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
    ...(previous[0] && { previous: previous[0] }),
    ...(value.operationId !== undefined && {
      schemaVersion: 1 as const,
      operationId: value.operationId,
    }),
    ...(value.confirmedName !== undefined && { confirmedName: value.confirmedName }),
  };
}

export async function readConnectionSetups(): Promise<ConnectionSetup[]> {
  const data = await chrome.storage.local.get([connectionSetupKey, legacyConnectionSetupKey]);
  const raw: unknown = data[connectionSetupKey];
  if (raw !== undefined && !isRecord(raw))
    throw new Error('The unfinished connection setup could not be read.');
  const setups = new Map<string, ConnectionSetup>();
  if (data[legacyConnectionSetupKey] !== undefined) {
    const legacy = decodeSetup(data[legacyConnectionSetupKey]);
    setups.set(legacy.definition.key, legacy);
  }
  for (const [key, value] of Object.entries(raw ?? {})) {
    const setup = decodeSetup(value);
    if (setup.definition.key !== key)
      throw new Error('The unfinished connection setup could not be read.');
    setups.set(key, setup);
  }
  return [...setups.values()];
}

export async function readConnectionSetup(key: string) {
  return (await readConnectionSetups()).find((setup) => setup.definition.key === key);
}

/** Observe recovery changes, including a submission that finishes before the next read. */
export function observeConnectionSetups(changed: (recordedIds: ReadonlySet<string>) => void) {
  const onChanged = (items: Record<string, chrome.storage.StorageChange>) => {
    if (!(connectionSetupKey in items || legacyConnectionSetupKey in items)) return;
    const raw: unknown = items[connectionSetupKey]?.newValue;
    const recordedIds = new Set<string>();
    if (isRecord(raw)) {
      for (const record of Object.values(raw)) {
        if (isRecord(record) && typeof record.id === 'string') recordedIds.add(record.id);
      }
    }
    changed(recordedIds);
  };
  chrome.storage.local.onChanged.addListener(onChanged);
  return () => chrome.storage.local.onChanged.removeListener(onChanged);
}

async function writeConnectionSetup(key: string, setup?: ConnectionSetup) {
  await navigator.locks.request(connectionSetupKey, async () => {
    const pending = new Map(
      (await readConnectionSetups()).map((record) => [record.definition.key, record]),
    );
    if (setup) pending.set(key, setup);
    else pending.delete(key);
    // Import a legacy single slot before removing the old copy. It held no credential material.
    const legacy = (await chrome.storage.local.get(legacyConnectionSetupKey))[
      legacyConnectionSetupKey
    ];
    if (legacy !== undefined && !setup && decodeSetup(legacy).definition.key === key)
      await chrome.storage.local.remove(legacyConnectionSetupKey);
    await chrome.storage.local.set({ [connectionSetupKey]: Object.fromEntries(pending) });
    if (legacy !== undefined) await chrome.storage.local.remove(legacyConnectionSetupKey);
  });
}

type ReadySettings = Extract<SettingsState, { state: 'ready' }>;
type SetupDependencies = {
  readSettings(): Promise<ReadySettings>;
  requireSettingsWriter(): Promise<void>;
  commit(
    settings: ReadySettings,
    connections: ConnectionDefinition[],
    fence: SetupFence,
  ): Promise<ReadySettings>;
  credential: typeof nativeCredentialCall;
  hold: typeof holdConnection;
};

export async function listConnectionSetups(
  credential: Pick<SetupDependencies, 'credential'>['credential'],
) {
  const reply = await credential({ action: 'connection-setups' });
  if (
    !Array.isArray(reply.connectionSetups) ||
    !reply.connectionSetups.every(validConnectionReservation)
  )
    throw new Error('Update the signed Saul helper before managing shared connections.');
  return reply.connectionSetups;
}

export async function releaseConnectionSetup(
  credential: Pick<SetupDependencies, 'credential'>['credential'],
  fence: SetupFence,
) {
  // The just-closed port may still be stopping. This only compares and drops public metadata.
  for (let attempt = 0; ; attempt++) {
    try {
      await credential({
        action: 'connection-setup-release',
        connectionKey: fence.connectionKey,
        token: fence.token,
      });
      return;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes('connection is busy') ||
        attempt >= 2
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
}

export async function requireConnectionCoordination(credential: SetupDependencies['credential']) {
  const reply = await credential({ action: 'connection-capabilities' });
  if (reply.connectionCoordination !== 1)
    throw new Error('Update the signed Saul helper before managing shared connections.');
}

async function openReviewedSetup(
  setup: ConnectionSetup & { operationId: string },
  start: boolean,
  { credential, hold }: Pick<SetupDependencies, 'credential' | 'hold'>,
  signal?: AbortSignal,
) {
  const reviewed = start
    ? undefined
    : (await listConnectionSetups(credential)).find(
        (row) =>
          row.origin === 'saul' &&
          row.operationId.toLowerCase() === setup.operationId.toLowerCase(),
      );
  if (!start && reviewed?.connectionKey !== setup.definition.key)
    throw new Error(
      'Connection setup was released. Review the saved connection before starting again.',
    );
  return hold(
    {
      action: 'connection-setup-hold',
      connectionKey: setup.definition.key,
      ...(setup.definition.accountId && { accountId: setup.definition.accountId }),
      operationId: setup.operationId,
      ...(reviewed && { previousToken: reviewed.token }),
    },
    signal,
  );
}

export class ConnectionSetupNotAdmitted extends Error {}

export async function holdReviewedSetup(
  base: ConnectionSetup,
  prior: ConnectionSetup | undefined,
  dependencies: Pick<SetupDependencies, 'credential' | 'hold'>,
  signal?: AbortSignal,
) {
  const attempt = {
    ...base,
    schemaVersion: 1 as const,
    operationId: base.operationId ?? crypto.randomUUID(),
  };
  await writeConnectionSetup(base.definition.key, attempt);
  try {
    const held = await openReviewedSetup(
      attempt,
      base.operationId === undefined,
      dependencies,
      signal,
    );
    return { attempt, held };
  } catch (error) {
    if (
      base.operationId === undefined &&
      error instanceof CredentialRequestError &&
      (error.reason === 'connection_busy' || error.reason === 'connection_reserved')
    ) {
      await writeConnectionSetup(base.definition.key, prior);
      throw new ConnectionSetupNotAdmitted(error.message);
    }
    throw error;
  }
}

export class ConnectionSetupCoordinator {
  constructor(private readonly dependencies: SetupDependencies) {}

  private remember(setup: ConnectionSetup) {
    return writeConnectionSetup(setup.definition.key, setup);
  }

  async save(request: ConnectionSetup, key: string, resume: boolean) {
    return navigator.locks.request(connectionSetupLock(request.definition.key), async () => {
      const { readSettings, commit, credential } = this.dependencies;
      const pending = await readConnectionSetup(request.definition.key);
      if (
        resume
          ? !matchesReviewedSetup(pending, request)
          : !!pending || request.phase !== 'credential'
      )
        throw new Error('Connection setup changed. Reopen Connections to review it.');
      const base = pending ?? {
        id: request.id,
        phase: request.phase,
        definition: connectionDefinition(request.definition),
        ...(request.previous && { previous: connectionDefinition(request.previous) }),
        ...(request.confirmedName !== undefined && { confirmedName: request.confirmedName }),
      };
      let latest = await readSettings();
      let connections = setupConnections(
        latest.settings.connections,
        base,
        base.phase === 'settings',
      );
      if (base.phase === 'credential' && base.definition.kind === 'openai-api' && !key) {
        const host = URL.parse(base.definition.baseUrl ?? 'https://api.openai.com/v1')?.hostname;
        if (!host || !['localhost', '127.0.0.1', '[::1]'].includes(host))
          throw new Error('Enter the API key to submit the credential change again.');
      }
      if (connections === latest.settings.connections) {
        await this.verifyCredential(base.definition);
        // A settings save whose acknowledgement was lost is already confirmed by readback.
        if (base.operationId) {
          const reservation = (await listConnectionSetups(credential)).find(
            (row) =>
              row.origin === 'saul' &&
              row.operationId.toLowerCase() === base.operationId!.toLowerCase(),
          );
          if (reservation) await releaseConnectionSetup(credential, reservation);
        }
        await writeConnectionSetup(base.definition.key);
        return latest;
      }
      await this.dependencies.requireSettingsWriter();
      await requireConnectionCoordination(credential);
      if (base.definition.kind === 'chatgpt-plan') await this.verifyCredential(base.definition);
      const { attempt, held } = await holdReviewedSetup(base, pending, this.dependencies);
      const token = held.evidence.token;
      if (!token) {
        await held.close();
        throw new Error('The helper did not confirm the connection setup.');
      }
      const fence = { connectionKey: attempt.definition.key, token };
      let saved: ReadySettings;
      try {
        held.signal.throwIfAborted();
        // Recheck the reviewed definition under the hold before touching credentials.
        latest = await readSettings();
        setupConnections(latest.settings.connections, attempt, attempt.phase === 'settings');
        if (attempt.phase === 'credential') {
          const c = attempt.definition;
          if (c.kind === 'openai-api') {
            const status = await credential({
              action: 'connection-key-save',
              connectionKey: c.key,
              endpoint: c.baseUrl ?? 'https://api.openai.com/v1',
              key,
              setupToken: token,
            });
            if (
              !validConnectionStatus(status.connection) ||
              !status.connection.connected ||
              status.connection.endpoint !== (c.baseUrl ?? 'https://api.openai.com/v1')
            )
              throw new Error('The helper did not confirm the key for this endpoint.');
          } else if (attempt.confirmedName && c.accountId) {
            await credential({
              action: 'confirm-app-name',
              accountId: c.accountId,
              suggestedAppName: attempt.confirmedName,
              setupToken: token,
            });
          }
          attempt.phase = 'settings';
          await this.remember(attempt);
        } else {
          await this.verifyCredential(attempt.definition);
        }
        held.signal.throwIfAborted();
        latest = await readSettings();
        connections = setupConnections(latest.settings.connections, attempt);
        saved =
          connections === latest.settings.connections
            ? latest
            : await commit(latest, connections, fence);
      } finally {
        await held.close();
      }
      await releaseConnectionSetup(credential, fence);
      await writeConnectionSetup(base.definition.key);
      return saved;
    });
  }

  private async verifyCredential(definition: ConnectionDefinition) {
    const { credential } = this.dependencies;
    if (definition.kind === 'chatgpt-plan') {
      const reply = await credential({ action: 'accounts' });
      if (
        !validPlanAccounts(reply.accounts) ||
        !reply.accounts.some(
          (account) =>
            account.id === definition.accountId && account.signedIn && account.planEnabled,
        )
      )
        throw new Error(
          'Sign in to the original account and allow plan use before finishing this connection.',
        );
      return;
    }
    const endpoint = definition.baseUrl ?? 'https://api.openai.com/v1';
    const reply = await credential({
      action: 'connection-key-status',
      connectionKey: definition.key,
      endpoint,
    });
    if (!validConnectionStatus(reply.connection) || reply.connection.endpoint !== endpoint)
      throw new Error(
        'The helper could not verify this connection. Check the signed helper before continuing.',
      );
    if (!reply.connection.connected) {
      const setup = await readConnectionSetup(definition.key);
      if (setup) await this.remember({ ...setup, phase: 'credential' });
      throw new Error(
        'This key is no longer available. Submit a key for this endpoint to finish setup.',
      );
    }
  }

  async discard(id: string, phase: ConnectionSetup['phase']) {
    const reviewed = (await readConnectionSetups()).find((item) => item.id === id);
    if (!reviewed || reviewed.phase !== phase)
      throw new Error('Connection setup changed. Reopen Connections to review it.');
    const key = reviewed.definition.key;
    await navigator.locks.request(connectionSetupLock(key), async () => {
      const current = await readConnectionSetup(key);
      if (current?.id !== id || current.phase !== phase)
        throw new Error('Connection setup changed. Reopen Connections to review it.');
      if (current.operationId) {
        const { credential } = this.dependencies;
        const reservation = (await listConnectionSetups(credential)).find(
          (row) =>
            row.origin === 'saul' &&
            row.operationId.toLowerCase() === current.operationId!.toLowerCase(),
        );
        if (reservation) await releaseConnectionSetup(credential, reservation);
      }
      await writeConnectionSetup(key);
    });
  }
}
