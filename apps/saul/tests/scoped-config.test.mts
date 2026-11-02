import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SharedPresetsStore } from '../native/shared-presets.mts';
import { portableSettings, restoreSettings } from '../src/storage/scoped-config';
import { validateActionState } from '../src/actions/contract';
import { actionHash } from '../native/action-store.mts';
import { DEFAULT_SETTINGS } from '../src/storage/settings';

it('saves scoped settings without overwriting siblings and rejects stale or malformed sections', () => {
  const directory = mkdtempSync(join(tmpdir(), 'saul-config-'));
  try {
    const store = new SharedPresetsStore(join(directory, 'settings.json'));
    writeFileSync(store.path, JSON.stringify({ apps: { ez: { keep: true } } }));
    store.saveScope('settings', 0, { summaryPdfProcessing: 'local' });
    store.saveScope('calls', 0, { library: [] });
    expect(() => store.saveScope('settings', 0, {})).toThrow('Reload');
    expect(store.readScope('settings').value).toEqual({ summaryPdfProcessing: 'local' });
    expect(JSON.parse(readFileSync(store.path, 'utf8')).apps.ez).toEqual({ keep: true });
    writeFileSync(store.path, '{"apps":{"saul":{"settings":false}}}');
    expect(() => store.saveScope('settings', 0, {})).toThrow('Original file preserved');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
it('round trips preferences and recipes without account or key material, clearing keys on endpoint edits', () => {
  const local = structuredClone(DEFAULT_SETTINGS);
  local.openaiCompatible.apiKey = 'PRIVATE';
  local.chatgptPlan = { accountId: 'LOCAL-ACCOUNT', model: 'fixture' };
  local.sharedPresetRevision = 1;
  const value = portableSettings(local);
  expect(JSON.stringify(value)).not.toMatch(/PRIVATE|LOCAL-ACCOUNT/);
  expect(restoreSettings(local, { revision: 2, value }).openaiCompatible.apiKey).toBe('PRIVATE');
  const changed = structuredClone(local);
  changed.openaiCompatible.baseUrl = 'https://other.test/v1';
  expect(
    restoreSettings(local, { revision: 2, value: portableSettings(changed) }).openaiCompatible
      .apiKey,
  ).toBe('');
});

for (const name of [
  '../../../config.example.json',
  '../../../contracts/fixtures/config.calls.json',
]) {
  it(`loads ${name} through production stores and preserves sibling scopes`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'saul-config-example-'));
    try {
      const original = readFileSync(new URL(name, import.meta.url), 'utf8');
      const path = join(directory, 'settings.json');
      writeFileSync(path, original);
      const store = new SharedPresetsStore(path);
      const library = store.read();
      const local = structuredClone(DEFAULT_SETTINGS);
      local.sharedPresetRevision = library.revision;
      local.configuration!.presets = library.presets.map((p) => ({
        ...p,
        provider: 'chatgpt-plan',
      }));
      const restored = restoreSettings(local, store.readScope('settings'));
      expect(restored.configuration!.recipes[0]!.presetId).toBe(library.presets[0]!.id);
      expect(restored.configuration!.presets).toHaveLength(2);
      expect(restored.configuration!.presets.every((p) => !p.accountId)).toBe(true);
      const calls: unknown = store.readScope('calls').value;
      validateActionState(calls);
      for (const choice of calls.library || []) {
        expect(choice.revision.approved).not.toBe(true);
        expect(actionHash(choice.revision)).toBe(choice.revision.revision);
      }
      const before = JSON.parse(original).apps.ez;
      store.saveScope('settings', restored.scopedConfigRevision!, portableSettings(restored));
      expect(JSON.parse(readFileSync(path, 'utf8')).apps.ez).toEqual(before);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

it('rejects multibyte scoped data before it can exceed native transport or change the saved file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'saul-config-size-'));
  try {
    const store = new SharedPresetsStore(join(directory, 'settings.json'));
    store.saveScope('calls', 0, { library: [] });
    const original = readFileSync(store.path, 'utf8');
    expect(() => store.saveScope('calls', 1, { text: '中'.repeat(250_001) })).toThrow('750 KB');
    expect(readFileSync(store.path, 'utf8')).toBe(original);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
