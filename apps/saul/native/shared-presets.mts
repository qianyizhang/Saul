import { upgradeConnectionDocument } from './connection-migration.mts';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  lstatSync,
  chmodSync,
  openSync,
  fsyncSync,
  closeSync,
} from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isRecord, errorCode } from './value.mts';
import {
  validScopedConfig,
  validateScopedConfigValue,
  validateSharedPresets,
  validateConnections,
  validateConnectionChanges,
  DEFAULT_CONNECTIONS,
  type ConnectionDefinition,
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
  private update<T>(change: (document: Record<string, unknown>) => T): T {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const lockPath = `${this.path}.lock.sqlite3`;
    for (const path of [this.path, lockPath]) {
      try {
        if (!lstatSync(path).isFile()) throw new Error('Settings paths must be regular files.');
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error;
      }
    }
    // SQLite supplies the same crash-released process lock to Swift and Node.
    // It contains no settings; all data remains in the JSON document.
    const lock = new DatabaseSync(lockPath);
    try {
      chmodSync(lockPath, 0o600);
      lock.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
      try {
        const document = upgradeConnectionDocument(this.document());
        this.library(document);
        const result = change(document);
        this.writeDocument(document);
        return result;
      } finally {
        lock.exec('ROLLBACK');
      }
    } finally {
      lock.close();
    }
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
  private readDocument(): Record<string, unknown> {
    const original = this.document();
    const upgraded = upgradeConnectionDocument(original);
    if (JSON.stringify(original) === JSON.stringify(upgraded)) return original;
    return this.update((document) => document);
  }
  readScope(section: string): import('./shared-presets-contract.mts').ScopedConfig {
    return this.scope(this.readDocument(), section);
  }
  private scope(
    document: Record<string, unknown>,
    section: string,
  ): import('./shared-presets-contract.mts').ScopedConfig {
    const apps = document.apps;
    if (apps !== undefined && !isRecord(apps)) throw new Error('Invalid app settings.');
    const saul = apps?.saul;
    if (saul !== undefined && !isRecord(saul)) throw new Error('Invalid Saul settings.');
    const value = saul?.[section];
    if (value === undefined) return { revision: 0 };
    if (!validScopedConfig(value))
      throw new Error('Invalid scoped settings. Original file preserved.');
    if (value.value !== undefined) validateScopedConfigValue(value.value);
    return value;
  }
  saveScope(section: string, revision: number, value: Record<string, unknown>) {
    return this.update((document) => this.setScope(document, section, revision, value));
  }
  private setScope(
    document: Record<string, unknown>,
    section: string,
    revision: number,
    value: Record<string, unknown>,
  ) {
    validateScopedConfigValue(value);
    if (this.scope(document, section).revision !== revision)
      throw new Error('Scoped settings changed. Reload before saving again.');
    const saved = { revision: revision + 1, value };
    const apps = isRecord(document.apps) ? document.apps : {};
    const saul = isRecord(apps.saul) ? apps.saul : {};
    document.apps = { ...apps, saul: { ...saul, [section]: saved } };
    return saved;
  }
  private writeDocument(document: Record<string, unknown>) {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(document, null, 2) + '\n', {
        mode: 0o600,
        flag: 'wx',
      });
      const descriptor = openSync(temporary, 'r');
      try {
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      renameSync(temporary, this.path);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  read(): SharedPresets {
    return this.library(this.readDocument());
  }
  private library(document: Record<string, unknown>): SharedPresets {
    const value = document.modelPresets;
    if (value === undefined)
      return { revision: 0, presets: [], connections: structuredClone([...DEFAULT_CONNECTIONS]) };
    const connections = isRecord(value) ? value.connections : undefined;
    validateConnections(connections);
    if (!isRecord(value) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0)
      throw new Error('Shared presets could not be read. The original file is preserved.');
    validateSharedPresets(value.presets);
    return {
      revision: Number(value.revision),
      connections,
      presets: value.presets.map((p) => ({ ...p, id: p.id.toLowerCase() })),
    };
  }
  save(
    revision: number,
    presets: SharedPreset[],
    connections?: ConnectionDefinition[],
  ): SharedPresets {
    return this.update((document) => this.setPresets(document, revision, presets, connections));
  }
  private setPresets(
    document: Record<string, unknown>,
    revision: number,
    presets: SharedPreset[],
    connections?: ConnectionDefinition[],
  ): SharedPresets {
    validateSharedPresets(presets);
    const current = this.library(document);
    if (current.revision !== revision)
      throw new Error(
        'Shared presets changed in the other app. Reload saved settings before saving again.',
      );
    const definitions = connections ?? current.connections;
    validateConnections(definitions);
    validateConnectionChanges(current.connections, definitions);
    const saved = {
      ...(isRecord(document.modelPresets) ? document.modelPresets : {}),
      revision: revision + 1,
      presets,
      connections: definitions,
    };
    document.modelPresets = saved;
    return saved;
  }
  commit(
    section: string,
    revision: number,
    value: Record<string, unknown>,
    presetRevision: number,
    presets: SharedPreset[],
    connections?: ConnectionDefinition[],
  ) {
    return this.update((document) => {
      const config = this.setScope(document, section, revision, value);
      const library = this.setPresets(document, presetRevision, presets, connections);
      return { config, library };
    });
  }
  import(presets: SharedPreset[]): SharedPresets {
    return this.update((document) => {
      validateSharedPresets(presets);
      const current = this.library(document);
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
        : this.setPresets(document, current.revision, imported);
    });
  }
}
