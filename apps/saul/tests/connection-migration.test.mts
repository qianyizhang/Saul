import { it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SharedPresetsStore } from '../native/shared-presets.mts';
import { SharedHistory, HistoryConnection } from '../native/history.mts';
import { DEFAULT_CONNECTIONS } from '../native/shared-presets-contract.mts';
import { createSettingsOwner } from '../src/storage/settings';

it('upgrades shared connection names once and preserves IDs, scoped settings and original conflicts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'connection-upgrade-'));
  try {
    const path = join(dir, 'settings.json');
    const original = {
      appearance: { theme: 'dark' },
      modelPresets: {
        revision: 7,
        providers: DEFAULT_CONNECTIONS,
        presets: [
          {
            id: 'c14b29f3-3ec2-4efc-8bed-e05531aef2cb',
            name: 'Saved',
            model: 'saved-model',
            effort: '',
            fast: false,
            providerKey: 'openai-api',
          },
        ],
      },
      apps: {
        saul: {
          settings: { revision: 2, value: { providerConnections: { 'openai-api': 'personal' } } },
        },
      },
    };
    writeFileSync(path, JSON.stringify(original));
    const store = new SharedPresetsStore(path);
    expect(store.read().presets[0]?.connectionKey).toBe('openai-api');
    const saved = readFileSync(path, 'utf8');
    expect(saved).not.toContain('providerKey');
    expect(saved).not.toContain('"providers"');
    expect(JSON.parse(saved)).toMatchObject({
      appearance: { theme: 'dark' },
      modelPresets: { revision: 7 },
      apps: { saul: { settings: { value: { connectionProfiles: { 'openai-api': 'personal' } } } } },
    });
    store.read();
    expect(readFileSync(path, 'utf8')).toBe(saved);
    const conflicting = JSON.stringify({
      ...original,
      modelPresets: { ...original.modelPresets, connections: [] },
    });
    writeFileSync(path, conflicting);
    expect(() => store.read()).toThrow('Conflicting');
    expect(readFileSync(path, 'utf8')).toBe(conflicting);
    const malformed = JSON.stringify({ ...original, apps: 'invalid' });
    writeFileSync(path, malformed);
    expect(() => store.read()).toThrow('Invalid app settings');
    expect(readFileSync(path, 'utf8')).toBe(malformed);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('upgrades browser settings through their write owner without losing local credentials', async () => {
  let stored: unknown = {
    providers: DEFAULT_CONNECTIONS,
    providerConnections: { 'openai-api': 'profile' },
    openaiCompatible: {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'synthetic-key',
      model: 'saved',
    },
  };
  let writes = 0;
  const owner = createSettingsOwner({
    read: async () => stored,
    write: async (value) => {
      stored = value.saul_user_settings;
      writes++;
    },
  });
  const first = await owner({ action: 'read' });
  expect(first.state).toBe('ready');
  expect(stored).toMatchObject({
    connectionProfiles: { 'openai-api': 'profile' },
    openaiCompatible: { apiKey: 'synthetic-key' },
  });
  expect(stored).not.toHaveProperty('providers');
  await owner({ action: 'read' });
  expect(writes).toBe(1);
});

it('upgrades frozen native and browser history transactionally and refuses downgrades', () => {
  const dir = mkdtempSync(join(tmpdir(), 'connection-history-'));
  try {
    let history = new SharedHistory(dir);
    history.connection.exec({
      sql: 'INSERT INTO ez_entry(id,created_at,data) VALUES (?,?,?)',
      bind: [
        'saved',
        1,
        JSON.stringify({
          providerSnapshot: DEFAULT_CONNECTIONS[1],
          presetSnapshot: { providerKey: 'openai-api' },
          inputValues: { providerKey: 'literal user input' },
        }),
      ],
    });
    history.connection.exec('PRAGMA user_version=3');
    history.connection.close();
    history = new SharedHistory(dir);
    const saved = JSON.parse(
      String(history.connection.selectValue("SELECT data FROM ez_entry WHERE id='saved'")),
    );
    expect(saved.connectionSnapshot.key).toBe('openai-api');
    expect(saved.presetSnapshot.connectionKey).toBe('openai-api');
    expect(saved.inputValues.providerKey).toBe('literal user input');
    expect(history.connection.selectValue('PRAGMA user_version')).toBe(4);
    history.connection.exec({
      sql: 'UPDATE ez_entry SET data=?',
      bind: [
        JSON.stringify({ providerSnapshot: { key: 'old' }, connectionSnapshot: { key: 'new' } }),
      ],
    });
    history.connection.exec('PRAGMA user_version=3');
    history.connection.close();
    expect(() => new SharedHistory(dir)).toThrow('Conflicting');
    const raw = new HistoryConnection(join(dir, 'history.sqlite3'));
    expect(raw.selectValue('PRAGMA user_version')).toBe(3);
    expect(JSON.parse(String(raw.selectValue('SELECT data FROM ez_entry')))).toEqual({
      providerSnapshot: { key: 'old' },
      connectionSnapshot: { key: 'new' },
    });
    raw.exec('PRAGMA user_version=99');
    raw.close();
    expect(() => new SharedHistory(dir)).toThrow('Unsupported shared history version');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
