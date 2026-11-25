import { createHash } from 'node:crypto';

export function historyCursor(scope: readonly unknown[], cursor?: string) {
  const signature = createHash('sha256').update(JSON.stringify(scope)).digest('hex');
  function reject(): never {
    throw new Error('History cursor does not belong to this view and scope.');
  }
  function read(): number | undefined {
    if (!cursor) return;
    try {
      const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      if (
        Array.isArray(value) &&
        value.length === 2 &&
        value[0] === signature &&
        typeof value[1] === 'number' &&
        Number.isSafeInteger(value[1]) &&
        value[1] >= 0
      )
        return value[1];
    } catch {
      reject();
    }
    reject();
  }
  return {
    read,
    write: (position: number) =>
      Buffer.from(JSON.stringify([signature, position])).toString('base64url'),
  };
}
