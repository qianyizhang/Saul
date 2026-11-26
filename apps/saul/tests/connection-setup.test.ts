import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIGURATION } from '../src/configuration/definition';
import { requestSettings } from '../src/configuration/client';
import { changeOutsideSetup, saveSetup, discardConnectionSetup } from '../src/connections/client';
import { createConnectionService } from '../src/connections/service';
import { CredentialRequestError, nativeCredentialCall } from '../src/native/credentials';
import { requireConnectionSettings } from '../src/native/config-transport';
import {
  ConnectionSetupCoordinator,
  ConnectionSetupNotAdmitted,
  legacyConnectionSetupKey,
  readConnectionSetup,
  readConnectionSetups,
  type ConnectionSetup,
} from '../src/connections/setup';
import { holdConnection } from '../src/connections/credential-hold';
import type { CredentialRequest } from '../shared/protocol/credentials-contract.mts';
import type { ConnectionReservation } from '../shared/protocol/connection-coordination.mts';
import type { ConnectionDefinition } from '../shared/protocol/shared-presets-contract.mts';
import type { SettingsState } from '../src/settings/contract';

vi.mock('../src/configuration/client', () => ({ requestSettings: vi.fn() }));
vi.mock('../src/native/credentials', async (load) => ({
  ...(await load<typeof import('../src/native/credentials')>()),
  credentialCall: vi.fn(),
  nativeCredentialCall: vi.fn(),
}));
vi.mock('../src/native/config-transport', () => ({ requireConnectionSettings: vi.fn() }));
vi.mock('../src/connections/credential-hold', () => ({ holdConnection: vi.fn() }));

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../contracts/fixtures/connection-setup.json', import.meta.url),
    'utf8',
  ),
) as {
  definition: ConnectionDefinition;
  cases: {
    id: string;
    phase: ConnectionSetup['phase'];
    savedDefinition: ConnectionDefinition | null;
    keyAvailable: boolean;
    expected: 'review-credential' | 'save-definition' | 'already-saved' | 'conflict';
  }[];
};

const definition = fixture.definition;
const setup: ConnectionSetup = { id: 'draft', definition, phase: 'credential' };
type Ready = Extract<SettingsState, { state: 'ready' }>;
let storage: Record<string, unknown>;
let saved: Ready;
let reservations: ConnectionReservation[];
let keyAvailable: boolean;
const credential = vi.fn(async (request: CredentialRequest) => {
  switch (request.action) {
    case 'connection-capabilities':
      return { connectionCoordination: 1 };
    case 'connection-setups':
      return { connectionSetups: reservations };
    case 'connection-setup-release':
      reservations = reservations.filter((row) => row.token !== request.token);
      return {};
    case 'connection-key-save':
      keyAvailable = true;
      return { connection: { connected: true, endpoint: request.endpoint } };
    case 'connection-key-status':
      return { connection: { connected: keyAvailable, endpoint: request.endpoint } };
    default:
      throw new Error('Unexpected fixture credential operation.');
  }
});
const hold = vi.fn<typeof holdConnection>(async (request) => {
  if (request.action !== 'connection-setup-hold') throw new Error('Wrong hold request.');
  if (request.previousToken && !reservations.some((row) => row.token === request.previousToken))
    throw new Error('Old setup token.');
  const token = crypto.randomUUID();
  reservations = [
    ...reservations.filter((row) => row.connectionKey !== request.connectionKey),
    {
      connectionKey: request.connectionKey,
      origin: 'saul',
      operationId: request.operationId,
      token,
    },
  ];
  return {
    evidence: { type: 'connection-held', token },
    signal: new AbortController().signal,
    close: vi.fn(),
  };
});
const commit = vi.fn(async (latest: Ready, connections: ConnectionDefinition[]) => {
  saved = { ...latest, settings: { ...latest.settings, connections } };
  return saved;
});
const requireSettingsWriter = vi.fn(async () => {});
const coordinator = new ConnectionSetupCoordinator({
  readSettings: async () => saved,
  requireSettingsWriter,
  credential,
  hold,
  commit,
});

beforeEach(() => {
  vi.clearAllMocks();
  storage = {};
  reservations = [];
  keyAvailable = true;
  saved = {
    state: 'ready',
    revision: '1',
    settings: { ...DEFAULT_CONFIGURATION, sharedCredentials: 'saul', connections: [] },
  };
  vi.mocked(requestSettings).mockImplementation(async () => saved);
  vi.mocked(requireConnectionSettings).mockImplementation(requireSettingsWriter);
  vi.mocked(nativeCredentialCall).mockImplementation(credential);
  vi.mocked(holdConnection).mockImplementation(hold);
  const service = createConnectionService(async (request) => {
    const action = request as { action: string; settings: Ready['settings'] };
    return action.action === 'read' ? saved : commit(saved, action.settings.connections);
  });
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: async ({ message }: { message: unknown }) => {
        try {
          return { success: true, result: await service.request(message) };
        } catch (cause) {
          return {
            success: false,
            error: (cause as Error).message,
            ...(cause instanceof ConnectionSetupNotAdmitted && { setupNotAdmitted: true }),
          };
        }
      },
    },
    storage: {
      local: {
        get: async () => structuredClone(storage),
        set: async (patch: Record<string, unknown>) => {
          Object.assign(storage, structuredClone(patch));
        },
        remove: async (key: string) => {
          delete storage[key];
        },
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

it.each(fixture.cases)(
  'reconciles reviewed setup without resending a key: $id',
  async (scenario) => {
    saved.settings.connections = scenario.savedDefinition ? [scenario.savedDefinition] : [];
    keyAvailable = scenario.keyAvailable;
    const pending = { ...setup, phase: scenario.phase };
    storage[legacyConnectionSetupKey] = pending;
    const result = coordinator.save(pending, '', true);
    if (scenario.expected === 'review-credential' || scenario.expected === 'conflict') {
      await expect(result).rejects.toThrow(
        scenario.expected === 'conflict' ? 'connection changed' : /submit|no longer available/i,
      );
      expect(await readConnectionSetup(definition.key)).toBeDefined();
    } else {
      await expect(result).resolves.toMatchObject({ settings: { connections: [definition] } });
      expect(await readConnectionSetup(definition.key)).toBeUndefined();
    }
    expect(
      credential.mock.calls.filter(([request]) => request.action === 'connection-key-save'),
    ).toHaveLength(0);
    expect(commit).toHaveBeenCalledTimes(scenario.expected === 'save-definition' ? 1 : 0);
  },
);

it('continues setup after a lost settings outcome without replaying its credential', async () => {
  commit.mockRejectedValueOnce(new Error('settings conflict'));
  await expect(coordinator.save(setup, 'synthetic-private-value', false)).rejects.toThrow(
    'settings conflict',
  );
  const restored = (await readConnectionSetup(definition.key))!;
  expect(restored.phase).toBe('settings');
  expect(JSON.stringify(storage)).not.toContain('synthetic-private-value');
  const remove = vi.fn();
  await expect(changeOutsideSetup(definition.key, definition, remove)).rejects.toThrow(
    'Finish or discard',
  );
  expect(remove).not.toHaveBeenCalled();
  await coordinator.save(restored, '', true);
  expect(
    credential.mock.calls
      .map(([request]) => request.action)
      .filter((action) => action === 'connection-key-save'),
  ).toHaveLength(1);
  expect(await readConnectionSetup(definition.key)).toBeUndefined();
  await expect(coordinator.save(restored, '', true)).rejects.toThrow('setup changed');
});

it('preserves another connection’s recovery and lets an unrelated setup complete', async () => {
  commit.mockRejectedValueOnce(new Error('settings conflict'));
  await expect(coordinator.save(setup, 'key', false)).rejects.toThrow('settings conflict');
  const other = { ...definition, key: 'other-api', name: 'Other' };
  await coordinator.save({ ...setup, id: 'other', definition: other }, 'other-key', false);
  expect(saved.settings.connections).toEqual([other]);
  expect(await readConnectionSetups()).toMatchObject([{ definition, phase: 'settings' }]);
  expect(reservations).toMatchObject([{ connectionKey: definition.key }]);
});

it('requires the installed settings writer before writing any credential', async () => {
  requireSettingsWriter.mockRejectedValueOnce(new Error('update storage helper'));
  await expect(coordinator.save(setup, 'key', false)).rejects.toThrow('update storage helper');
  expect(credential).not.toHaveBeenCalled();
  expect(hold).not.toHaveBeenCalled();
});

it('keeps the form retryable after a definite initial admission rejection', async () => {
  hold.mockRejectedValueOnce(new CredentialRequestError('Connection is busy.', 'connection_busy'));
  await expect(saveSetup(setup, 'key', false)).rejects.toBeInstanceOf(ConnectionSetupNotAdmitted);
  expect(await readConnectionSetup(definition.key)).toBeUndefined();
  expect(commit).not.toHaveBeenCalled();
  expect(credential.mock.calls.some(([request]) => request.action === 'connection-key-save')).toBe(
    false,
  );
  await expect(saveSetup(setup, 'key', false)).resolves.toMatchObject({
    settings: { connections: [definition] },
  });
});

it('restores a previous recovery after a definite rejection and retains uncertain admission evidence', async () => {
  storage[legacyConnectionSetupKey] = setup;
  hold.mockRejectedValueOnce(
    new CredentialRequestError('Another app is setting up.', 'connection_reserved'),
  );
  await expect(saveSetup(setup, 'key', true)).rejects.toBeInstanceOf(ConnectionSetupNotAdmitted);
  expect(await readConnectionSetup(definition.key)).toEqual(setup);

  hold.mockImplementationOnce(async (...args) => {
    const admitted = hold.getMockImplementation()!;
    await admitted(...args);
    throw new Error('Lost hold acknowledgement.');
  });
  await expect(saveSetup(setup, 'key', true)).rejects.toThrow('Lost hold acknowledgement.');
  const pending = (await readConnectionSetup(definition.key))!;
  expect(pending.operationId).toBe(reservations[0]?.operationId);
  expect(credential.mock.calls.some(([request]) => request.action === 'connection-key-save')).toBe(
    false,
  );
  await expect(saveSetup(pending, 'key', true)).resolves.toMatchObject({
    settings: { connections: [definition] },
  });
});

it('requires explicit recovery when another app released the reserved setup', async () => {
  commit.mockRejectedValueOnce(new Error('settings conflict'));
  await expect(coordinator.save(setup, 'key', false)).rejects.toThrow('settings conflict');
  reservations = [];
  const record = (await readConnectionSetup(definition.key))!;
  await expect(coordinator.save(record, '', true)).rejects.toThrow('setup was released');
  expect(hold).toHaveBeenCalledOnce();
  expect(commit).toHaveBeenCalledOnce();
  await coordinator.discard(record.id, 'settings');
  expect(await readConnectionSetup(definition.key)).toBeUndefined();
});

it('rejects a stale sign-out or sign-in before acting on a reassigned account', async () => {
  const previous = {
    key: 'original',
    name: 'Original',
    kind: 'chatgpt-plan',
    accountId: 'account-a',
  } as const;
  saved.settings.connections = [{ ...previous, key: 'replacement' }];
  const auth = vi.fn();
  await expect(changeOutsideSetup(previous.key, previous, auth)).rejects.toThrow(
    'connection changed',
  );
  await expect(changeOutsideSetup('new', undefined, auth, previous.accountId)).rejects.toThrow(
    'already has a connection',
  );
  expect(auth).not.toHaveBeenCalled();
});

it.each(['finish', 'discard'] as const)(
  'projects browser-local fields at the service boundary and can %s a managed connection',
  async (action) => {
    saved.settings.connections = [definition];
    const localDefinition = { ...definition, localProfileId: 'local-only-profile' };
    const renamed = { ...localDefinition, name: 'Reviewed managed connection' };
    commit.mockRejectedValueOnce(new Error('settings conflict'));
    await expect(
      saveSetup(
        { ...setup, definition: renamed, previous: localDefinition },
        'private-value',
        false,
      ),
    ).rejects.toThrow('settings conflict');
    const restored = (await readConnectionSetup(definition.key))!;
    expect(restored.previous).toEqual(definition);
    expect(JSON.stringify(storage)).not.toMatch(/localProfileId|local-only-profile|private-value/);
    await expect(discardConnectionSetup('stale', restored.phase)).rejects.toThrow('setup changed');
    if (action === 'finish') await saveSetup(restored, '', true);
    else await discardConnectionSetup(restored.id, restored.phase);
    expect(await readConnectionSetup(definition.key)).toBeUndefined();
    expect(
      credential.mock.calls.filter(([request]) => request.action === 'connection-key-save'),
    ).toHaveLength(1);
  },
);

it('preserves malformed receipts and rejects them before a credential mutation', async () => {
  storage[legacyConnectionSetupKey] = { ...setup, phase: ['credential'] };
  await expect(readConnectionSetups()).rejects.toThrow('could not be read');
  await expect(saveSetup(setup, 'key', false)).rejects.toThrow('could not be read');
  expect(storage[legacyConnectionSetupKey]).toBeDefined();
  expect(credential).not.toHaveBeenCalled();
});
