import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { secureDirectory } from './transport.mjs';

// Only user-approved labels are retained, keyed by the connected browser session.
// No tab inventory, URLs, proposal or approval token is written to disk.
export function createWindowLabels(directory) {
  let memory = {};
  const file = directory && join(directory, 'workspace-labels.json');
  const read = () => {
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
      if (error.code === 'ENOENT') return {};
      throw error;
    }
  };
  return {
    get: (session) => ({ ...read()[session] }),
    save(session, labels, sessions) {
      const next = read();
      for (const id of Object.keys(next)) if (!sessions.includes(id)) delete next[id];
      next[session] = labels;
      if (!file) {
        memory = next;
        return;
      }
      secureDirectory(directory);
      const temporary = `${file}.${randomUUID()}.tmp`;
      writeFileSync(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, file);
    },
  };
}
