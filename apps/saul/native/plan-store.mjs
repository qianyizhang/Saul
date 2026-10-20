import {
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  closeSync,
  unlinkSync,
  lstatSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { secureDirectory } from './transport.mjs';

export class PlanStore {
  constructor(directory) {
    this.directory = directory;
    secureDirectory(directory);
  }
  read() {
    try {
      const path = join(this.directory, 'accounts.json');
      const stat = lstatSync(path);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.uid !== process.getuid() ||
        stat.mode & 0o077
      )
        throw new Error('ChatGPT credential file must be owner-only (0600).');
      let value;
      try {
        value = JSON.parse(readFileSync(path, 'utf8'));
      } catch (cause) {
        throw new Error(
          'ChatGPT credential file could not be read. Restore its private backup or move it aside and sign in again.',
          { cause },
        );
      }
      const text = (v) => typeof v === 'string' && v.length > 0;
      const validAccount = (a) =>
        a &&
        text(a.clientId) &&
        (a.subject === undefined ? a.tokens === undefined : text(a.subject)) &&
        (a.email === undefined || typeof a.email === 'string') &&
        (a.tokens === undefined ||
          (a.tokens &&
            Number.isFinite(a.tokens.expiresAt) &&
            Array.isArray(a.tokens.scopes) &&
            a.tokens.scopes.every(text) &&
            ['accessToken', 'refreshToken', 'idToken'].every(
              (key) => a.tokens[key] === undefined || text(a.tokens[key]),
            )));
      if (
        !value ||
        value.version !== 1 ||
        !text(value.hostId) ||
        !Array.isArray(value.accounts) ||
        !value.accounts.every(validAccount) ||
        new Set(value.accounts.map((a) => a.clientId)).size !== value.accounts.length
      )
        throw new Error(
          'Unsupported ChatGPT credential store. Restore its private backup or move it aside and sign in again.',
        );
      return value;
    } catch (e) {
      if (e.code === 'ENOENT')
        return { version: 1, hostId: `urn:uuid:${randomUUID()}`, accounts: [] };
      throw e;
    }
  }
  write(value) {
    const temporary = join(this.directory, `${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, join(this.directory, 'accounts.json'));
    } finally {
      try {
        unlinkSync(temporary);
      } catch {
        /* Already renamed. */
      }
    }
  }
  async locked(fn) {
    const path = join(this.directory, 'accounts.lock');
    let fd;
    const deadline = Date.now() + 30_000;
    while (fd === undefined) {
      try {
        fd = openSync(path, 'wx', 0o600);
        writeFileSync(fd, String(process.pid));
      } catch (e) {
        if (e.code !== 'EEXIST') {
          if (fd !== undefined) {
            closeSync(fd);
            unlinkSync(path);
          }
          throw e;
        }
        // A separate short-lived reaper lock prevents two waiters from both
        // deleting a stale lock after one has already acquired a fresh lock.
        let reaper;
        const recovery = `${path}.recovery`;
        try {
          reaper = openSync(recovery, 'wx', 0o600);
          const pid = Number(readFileSync(path, 'utf8'));
          if (Number.isSafeInteger(pid) && pid > 0) {
            try {
              process.kill(pid, 0);
            } catch (err) {
              if (err.code === 'ESRCH') unlinkSync(path);
            }
          }
        } catch {
          /* Another waiter may be recovering, or the owner released. */
        } finally {
          if (reaper !== undefined) {
            closeSync(reaper);
            unlinkSync(recovery);
          }
        }
        if (Date.now() > deadline)
          throw new Error('ChatGPT credentials are busy. Try again shortly.', { cause: e });
        await delay(50);
      }
    }
    try {
      return await fn(this.read());
    } finally {
      closeSync(fd);
      unlinkSync(path);
    }
  }
}
export function accountSummary(account) {
  return {
    id: account.clientId,
    label: `${account.email || 'ChatGPT account'} · ${account.clientId.slice(-8)}`,
    signedIn: Boolean(account.tokens),
    planEnabled: Boolean(account.tokens?.scopes.includes('chatgpt.tokens.use.direct')),
  };
}
