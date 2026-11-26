import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSettingsEditor } from '../src/settings/editor';
import { requestSettings } from '../src/configuration/client';
import { DEFAULT_CONFIGURATION } from '../src/configuration/definition';
import { credentialCall } from '../src/native/credentials';
import {
  changeOutsideSetup,
  connectionSetupKey,
  discardConnectionSetup,
  readConnectionSetup,
  saveConnectionSetup,
  type ConnectionSetup,
} from '../src/settings/connection-setup';

vi.mock('../src/configuration/client', () => ({ requestSettings: vi.fn() }));
vi.mock('../src/native/credentials', () => ({ credentialCall: vi.fn() }));
const definition = {
  key: 'fixture-api',
  name: 'Fixture',
  kind: 'openai-api',
  baseUrl: 'https://example.test/v1',
} as const;
const setup: ConnectionSetup = { id: 'draft', definition, phase: 'credential' };
let storage: Record<string, unknown>;
beforeEach(() => {
  vi.resetAllMocks();
  storage = {};
  vi.stubGlobal('chrome', {
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
  vi.mocked(requestSettings).mockResolvedValue({
    state: 'ready',
    revision: '1',
    settings: { ...DEFAULT_CONFIGURATION, sharedCredentials: 'saul', connections: [] },
  });
  vi.mocked(credentialCall).mockResolvedValue({
    connection: { connected: true, endpoint: definition.baseUrl },
  });
});
afterEach(() => vi.unstubAllGlobals());

it('retains only public setup details after a conflict and finishes without rewriting a credential', async () => {
  const commit = vi
    .fn()
    .mockRejectedValueOnce(new Error('settings conflict'))
    .mockResolvedValue(undefined);
  await expect(
    saveConnectionSetup(setup, 'synthetic-private-value', commit, false),
  ).rejects.toThrow('settings conflict');
  const restored = (await readConnectionSetup())!;
  expect(restored.phase).toBe('settings');
  expect(JSON.stringify(storage)).not.toContain('synthetic-private-value');
  const remove = vi.fn();
  await expect(changeOutsideSetup(definition.key, definition, remove)).rejects.toThrow(
    'Finish or discard',
  );
  expect(remove).not.toHaveBeenCalled();
  await saveConnectionSetup(restored, '', commit, true);
  expect(vi.mocked(credentialCall).mock.calls.map(([request]) => request.action)).toEqual([
    'connection-key-save',
    'connection-key-status',
  ]);
  expect(await readConnectionSetup()).toBeUndefined();
  await expect(saveConnectionSetup(restored, '', commit, true)).rejects.toThrow('setup changed');
});

it('requires explicit same-endpoint repair if a confirmed credential was subsequently removed', async () => {
  const restored: ConnectionSetup = { ...setup, phase: 'settings' };
  storage[connectionSetupKey] = restored;
  vi.mocked(credentialCall).mockResolvedValueOnce({
    connection: { connected: false, endpoint: definition.baseUrl },
  });
  const commit = vi.fn();
  await expect(saveConnectionSetup(restored, '', commit, true)).rejects.toThrow(
    'no longer available',
  );
  expect(commit).not.toHaveBeenCalled();
  await expect(saveConnectionSetup(restored, '', commit, true)).rejects.toThrow('setup changed');
  expect(credentialCall).toHaveBeenCalledTimes(1);
  await saveConnectionSetup((await readConnectionSetup())!, 'new-value', commit, true);
  expect(commit).toHaveBeenCalledOnce();
});

it('rejects stale routes and malformed receipts before any credential write', async () => {
  await expect(
    saveConnectionSetup({ ...setup, previous: definition }, 'value', vi.fn(), false),
  ).rejects.toThrow('connection changed');
  storage[connectionSetupKey] = { ...setup, phase: ['credential'] };
  await expect(readConnectionSetup()).rejects.toThrow('could not be read');
  expect(credentialCall).not.toHaveBeenCalled();
});

it('discard clears the reviewed receipt only', async () => {
  storage[connectionSetupKey] = setup;
  await expect(discardConnectionSetup('older', setup.phase)).rejects.toThrow('setup changed');
  expect(await readConnectionSetup()).toMatchObject(setup);
  await discardConnectionSetup(setup.id, setup.phase);
  expect(await readConnectionSetup()).toBeUndefined();
  expect(credentialCall).not.toHaveBeenCalled();
});

it('rejects a stale sign-out or sign-in before acting on a reassigned account', async () => {
  const previous = {
    key: 'original',
    name: 'Original',
    kind: 'chatgpt-plan',
    accountId: 'account-a',
  } as const;
  vi.mocked(requestSettings).mockResolvedValue({
    state: 'ready',
    revision: '2',
    settings: {
      ...DEFAULT_CONFIGURATION,
      sharedCredentials: 'saul',
      connections: [{ ...previous, key: 'replacement' }],
    },
  });
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
  'reopens a managed connection with a local binding after a Settings conflict and can %s',
  async (action) => {
    const settings = {
      ...structuredClone(DEFAULT_CONFIGURATION),
      sharedCredentials: 'saul' as const,
      connections: [definition],
      connectionProfiles: { [definition.key]: 'local-profile' },
    };
    vi.mocked(requestSettings).mockResolvedValue({ state: 'ready', revision: '1', settings });
    const editor = createSettingsEditor(requestSettings);
    await editor.open();
    const previous = editor.getSnapshot().configuration.connections[0]!;
    expect(previous.localProfileId).toBe('local-profile');

    const commit = vi.fn().mockRejectedValueOnce(new Error('settings conflict'));
    await expect(
      saveConnectionSetup({ ...setup, previous }, 'private-value', commit, false),
    ).rejects.toThrow('settings conflict');
    expect(JSON.stringify(storage)).not.toMatch(/localProfileId|local-profile|private-value/);
    const restored = (await readConnectionSetup())!;
    expect(restored.previous).toEqual(definition);
    expect(restored.phase).toBe('settings');
    if (action === 'finish') {
      await saveConnectionSetup(restored, '', commit, true);
      expect(vi.mocked(credentialCall).mock.calls.map(([request]) => request.action)).toEqual([
        'connection-key-save',
        'connection-key-status',
      ]);
    } else {
      await discardConnectionSetup(restored.id, restored.phase);
      expect(credentialCall).toHaveBeenCalledTimes(1);
    }
    expect(await readConnectionSetup()).toBeUndefined();
    editor.close();
  },
);
