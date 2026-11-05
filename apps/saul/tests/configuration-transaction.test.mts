import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { SharedPresetsStore } from '../native/shared-presets.mts';
import { validatePlanRequest, validatePlanResult } from '../native/plan-protocol.mts';

it('commits both revisions together and leaves the exact document intact on rejection', () => {
  const directory = mkdtempSync(join(tmpdir(), 'configuration-transaction-'));
  try {
    const store = new SharedPresetsStore(join(directory, 'settings.json'));
    writeFileSync(
      store.path,
      JSON.stringify({ future: { retained: true }, apps: { ez: { future: 7 } } }),
    );
    const saved = store.commit('settings', 0, { responseLanguage: 'French' }, 0, []);
    expect(saved.config.revision).toBe(1);
    expect(saved.library.revision).toBe(1);
    expect(JSON.parse(readFileSync(store.path, 'utf8'))).toMatchObject({
      future: { retained: true },
      apps: { ez: { future: 7 } },
    });
    const before = readFileSync(store.path);
    for (const [scope, presets] of [
      [0, 1],
      [1, 0],
    ]) {
      expect(() =>
        store.commit('settings', scope!, { responseLanguage: 'Chinese' }, presets!, []),
      ).toThrow('changed');
      expect(readFileSync(store.path)).toEqual(before);
    }
    expect(() =>
      store.commit('settings', 1, { responseLanguage: 'Chinese' }, 1, [{ id: 'invalid' } as never]),
    ).toThrow();
    expect(readFileSync(store.path)).toEqual(before);
    const request = {
      action: 'config-commit',
      section: 'settings',
      revision: 1,
      presetRevision: 1,
      value: {},
      presets: [],
    } as const;
    validatePlanRequest(request);
    validatePlanResult(request, { type: 'result', ...saved });
    expect(() => validatePlanRequest({ ...request, presetRevision: -1 })).toThrow('transaction');
    expect(() => validatePlanResult(request, { type: 'result', library: saved.library })).toThrow(
      'invalid reply',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('preserves sibling scopes under concurrent process writes and releases locks after process death', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'configuration-processes-'));
  try {
    const path = join(directory, 'settings.json');
    const execute = promisify(execFile);
    const source = new URL('../native/shared-presets.mts', import.meta.url).href;
    const script = `import { SharedPresetsStore } from ${JSON.stringify(source)};
      const store = new SharedPresetsStore(process.argv[1]);
      for (let i=0; i<30; i++) store.saveScope(process.argv[2], i, { count: i+1 });`;
    await Promise.all(
      ['settings', 'calls'].map((scope) =>
        execute(process.execPath, ['--input-type=module', '-e', script, path, scope]),
      ),
    );
    const store = new SharedPresetsStore(path);
    for (const scope of ['settings', 'calls'])
      expect(store.readScope(scope)).toEqual({ revision: 30, value: { count: 30 } });
    // Abrupt exit skips close()/ROLLBACK. The next real save must still acquire the lock.
    await execute(process.execPath, [
      '--input-type=module',
      '-e',
      `import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.argv[1]); db.exec('BEGIN IMMEDIATE'); process.exit(0);`,
      `${path}.lock.sqlite3`,
    ]);
    store.saveScope('calls', 30, { count: 31 });
    expect(store.readScope('calls').revision).toBe(31);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
