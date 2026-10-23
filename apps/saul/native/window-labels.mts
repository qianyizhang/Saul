import { errorCode } from './value.mts';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { secureDirectory } from './transport.mts';

// Legacy helper-only labels are read for import into extension session storage
// on the next reviewed apply. No inventory, URLs or approval tokens are stored.
export function createWindowLabels(directory?: string) {
  let memory: Record<string, Record<string, string>> = {};
  const file = directory && join(directory, 'workspace-labels.json');
  const read = (): typeof memory => {
    if (!file) return memory;
    try {
      const value = JSON.parse(readFileSync(file, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid window labels');
      for (const [session, labels] of Object.entries(value)) {
        if (!/^[a-f0-9]{16}$/.test(session) || !labels || typeof labels !== 'object')
          throw new Error('Invalid window labels');
        for (const [id, title] of Object.entries(labels))
          if (!/^\d+$/.test(id) || typeof title !== 'string' || title.length > 1000)
            throw new Error('Invalid window label');
      }
      return value;
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return {};
      throw error;
    }
  };
  return {
    get: (session: string) => ({ ...read()[session] }),
    save(session: string, labels: Record<string, string>, sessions: string[]) {
      const next = read();
      for (const id of Object.keys(next)) if (!sessions.includes(id)) delete next[id];
      next[session] = labels;
      if (!file) {
        memory = next;
        return;
      }
      secureDirectory(directory!);
      const temporary = `${file}.${randomUUID()}.tmp`;
      writeFileSync(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, file);
    },
  };
}
