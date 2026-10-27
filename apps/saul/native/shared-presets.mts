import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isRecord, errorCode } from './value.mts';
import {
  validateSharedPresets,
  type SharedPreset,
  type SharedPresets,
} from './shared-presets-contract.mts';

export const sharedPresetsPath = () =>
  join(homedir(), 'Library/Application Support/Little Clarity/settings.json');

export class SharedPresetsStore {
  readonly path: string;
  constructor(path = sharedPresetsPath()) {
    this.path = path;
  }
  private document(): Record<string, unknown> {
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(this.path, 'utf8'));
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return {};
      throw error;
    }
    if (!isRecord(value)) throw new Error('Shared settings must be a JSON object.');
    return value;
  }
  read(): SharedPresets {
    const value = this.document().modelPresets;
    if (value === undefined) return { revision: 0, presets: [] };
    if (!isRecord(value) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0)
      throw new Error('Shared presets could not be read. The original file is preserved.');
    validateSharedPresets(value.presets);
    return {
      revision: Number(value.revision),
      presets: value.presets.map((p) => ({ ...p, id: p.id.toLowerCase() })),
    };
  }
  save(revision: number, presets: SharedPreset[]): SharedPresets {
    validateSharedPresets(presets);
    if (this.read().revision !== revision)
      throw new Error(
        'Shared presets changed in the other app. Reload saved settings before saving again.',
      );
    const saved = { revision: revision + 1, presets };
    const document = { ...this.document(), modelPresets: saved };
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(document, null, 2) + '\n', {
        mode: 0o600,
        flag: 'wx',
      });
      renameSync(temporary, this.path);
    } finally {
      rmSync(temporary, { force: true });
    }
    return saved;
  }
  import(presets: SharedPreset[]): SharedPresets {
    validateSharedPresets(presets);
    const current = this.read();
    const imported = [...current.presets];
    for (const item of presets) {
      if (imported.some((p) => p.id.toLowerCase() === item.id.toLowerCase())) continue;
      let name = item.name;
      for (
        let n = 2;
        imported.some((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase());
        n++
      )
        name = `${item.name.slice(0, 65)} (${n})`;
      imported.push({ ...item, id: item.id.toLowerCase(), name });
    }
    return imported.length === current.presets.length
      ? current
      : this.save(current.revision, imported);
  }
}
