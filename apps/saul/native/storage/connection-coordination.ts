import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { errorCode, isRecord } from '../../shared/model/value.mts';
import type { ConnectionDefinition } from '../../shared/protocol/shared-presets-contract.mts';
import {
  validConnectionReservation,
  type ConnectionReservation,
  type SetupFence,
} from '../../shared/protocol/connection-coordination.mts';

class BindingBusy extends Error {
  constructor() {
    super('This connection is busy. Try again after the current work stops.');
  }
}

const scopeKey = (key: string) => 'key:' + key;
const planScope = (accountId: string) => 'plan:' + accountId;

function scopes(connection: { key: string; accountId?: string }) {
  return [
    scopeKey(connection.key),
    ...(typeof connection.accountId === 'string' ? [planScope(connection.accountId)] : []),
  ];
}

function reservations(lock: DatabaseSync): ConnectionReservation[] {
  if (
    !lock
      .prepare("SELECT 1 FROM sqlite_schema WHERE name = 'connection_setup_reservation' LIMIT 1")
      .get()
  )
    return [];
  return lock
    .prepare(
      `SELECT connection_key AS connectionKey, account_id AS accountId,
       origin, operation_id AS operationId, token FROM connection_setup_reservation`,
    )
    .all()
    .map((row) => {
      if (row.accountId === null) delete row.accountId;
      if (!validConnectionReservation(row))
        throw new Error('Shared connection coordination is unavailable.');
      return row;
    });
}

/** The caller holds the shared settings lease until the JSON write returns. */
export function withConnectionSettingsWrite<T>(
  path: string,
  lock: DatabaseSync,
  before: ConnectionDefinition[],
  after: ConnectionDefinition[],
  fence: SetupFence | undefined,
  write: () => T,
): T {
  const previous = new Map(before.map((definition) => [definition.key, definition]));
  const next = new Map(after.map((definition) => [definition.key, definition]));
  const keys = new Set([...previous.keys(), ...next.keys()]);
  const changed = [...keys].filter((key) => {
    const a = previous.get(key);
    const b = next.get(key);
    return (
      !a ||
      !b ||
      a.kind !== b.kind ||
      a.name !== b.name ||
      a.accountId !== b.accountId ||
      a.baseUrl !== b.baseUrl
    );
  });
  if (!changed.length && !fence) return write();

  const busy = new Set(
    changed.flatMap((key) =>
      [previous.get(key), next.get(key)].flatMap((row) => (row ? scopes(row) : [])),
    ),
  );
  const current = reservations(lock);
  const stale = () =>
    new Error('Connection setup changed. Review the current setup before continuing.');
  if (fence) {
    const reservation = current.find((row) => row.connectionKey === fence.connectionKey);
    if (
      !reservation ||
      reservation.origin !== 'saul' ||
      reservation.token.toLowerCase() !== fence.token.toLowerCase() ||
      changed.some((key) => key !== fence.connectionKey) ||
      (reservation.accountId !== undefined &&
        next.get(fence.connectionKey)?.accountId !== reservation.accountId)
    )
      throw stale();
    let live = false;
    try {
      lockBinding(path, 'setup:' + fence.connectionKey).close();
    } catch (error) {
      if (!(error instanceof BindingBusy)) throw error;
      live = true;
    }
    if (!live) throw stale();
  }
  for (const row of current) {
    if (
      row.token.toLowerCase() !== fence?.token.toLowerCase() &&
      scopes({ key: row.connectionKey, accountId: row.accountId }).some((scope) => busy.has(scope))
    )
      throw new Error(
        `Finish or release the connection setup in ${row.origin === 'ez' ? 'EZ' : 'Saul'} before using this connection.`,
      );
  }
  const leases: DatabaseSync[] = [];
  try {
    for (const scope of [...busy].sort()) leases.push(lockBinding(path, scope));
    return write();
  } finally {
    for (const lease of leases) lease.close();
  }
}

function lockBinding(path: string, scope: string): DatabaseSync {
  const directory = path + '.connections';
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const dir = lstatSync(directory);
  if (!dir.isDirectory() || dir.mode & 0o077 || dir.uid !== process.getuid?.())
    throw new Error('Shared connection coordination is unavailable.');
  const file = join(directory, createHash('sha256').update(scope).digest('hex') + '.sqlite3');
  try {
    if (!lstatSync(file).isFile()) throw new Error('Connection lock must be a regular file.');
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
  const lock = new DatabaseSync(file);
  try {
    chmodSync(file, 0o600);
    lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');
    return lock;
  } catch (error) {
    lock.close();
    if (isRecord(error) && (error.errcode === 5 || error.errcode === 6)) throw new BindingBusy();
    throw error;
  }
}
