import { it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SharedPresetsStore } from '../native/storage/shared-presets.mts';
import { SharedHistory, HistoryConnection } from '../native/storage/history.mts';
import { DEFAULT_CONNECTIONS } from '../shared/protocol/shared-presets-contract.mts';

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

it('upgrades frozen native and browser history transactionally and refuses downgrades', () => {
  const dir = mkdtempSync(join(tmpdir(), 'connection-history-'));
  try {
    const savedId = '11111111-1111-4111-8111-111111111111';
    const path = join(dir, 'history.sqlite3');
    const old = new HistoryConnection(path);
    old.exec(
      readFileSync(new URL('../../../contracts/fixtures/history-v4.sql', import.meta.url), 'utf8'),
    );
    old.exec({
      sql: 'INSERT INTO ez_entry(id,created_at,data) VALUES (?,?,?)',
      bind: [
        savedId,
        1,
        JSON.stringify({
          id: savedId,
          schemaVersion: 1,
          createdAt: '2026-11-25T00:00:00Z',
          mode: 'Ask',
          query: 'Fixture',
          response: 'Answer',
          model: 'fixture',
          effort: '',
          status: 'completed',
          providerSnapshot: DEFAULT_CONNECTIONS[1],
          presetSnapshot: { providerKey: 'openai-api' },
          inputValues: { providerKey: 'literal user input' },
        }),
      ],
    });
    old.exec('PRAGMA user_version=3');
    old.close();
    const history = new SharedHistory(dir);
    const saved = JSON.parse(
      String(history.connection.selectValue('SELECT data FROM ez_entry WHERE id=?', [savedId])),
    );
    expect(saved.connectionSnapshot.key).toBe('openai-api');
    expect(saved.presetSnapshot.connectionKey).toBe('openai-api');
    expect(saved.inputValues.providerKey).toBe('literal user input');
    expect(history.connection.selectValue('PRAGMA user_version')).toBe(5);
    history.close();
    const badDir = join(dir, 'conflict');
    mkdirSync(badDir);
    const bad = new HistoryConnection(join(badDir, 'history.sqlite3'));
    bad.exec(
      readFileSync(new URL('../../../contracts/fixtures/history-v4.sql', import.meta.url), 'utf8'),
    );
    bad.exec({
      sql: "INSERT INTO ez_entry(id,created_at,data) VALUES ('saved',1,?)",
      bind: [
        JSON.stringify({ providerSnapshot: { key: 'old' }, connectionSnapshot: { key: 'new' } }),
      ],
    });
    bad.exec('PRAGMA user_version=3');
    bad.close();
    expect(() => new SharedHistory(badDir)).toThrow('Conflicting');
    const raw = new HistoryConnection(join(badDir, 'history.sqlite3'));
    expect(raw.selectValue('PRAGMA user_version')).toBe(3);
    expect(JSON.parse(String(raw.selectValue('SELECT data FROM ez_entry')))).toEqual({
      providerSnapshot: { key: 'old' },
      connectionSnapshot: { key: 'new' },
    });
    raw.exec('PRAGMA user_version=99');
    raw.close();
    expect(() => new SharedHistory(badDir)).toThrow('Unsupported shared history version');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
