import { beforeEach, expect, it, vi } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { SaulDatabase } from '../src/storage/db';

vi.mock('@sqlite.org/sqlite-wasm', () => ({ default: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

it('rejects unavailable persistence instead of reporting success from a memory database, and allows retry', async () => {
  const memoryDb = vi.fn();
  const install = vi.fn().mockRejectedValue(new Error('OPFS denied'));
  const exec = vi.fn();
  vi.mocked(sqlite3InitModule).mockResolvedValue({
    oo1: { DB: memoryDb },
    installOpfsSAHPoolVfs: install,
  } as unknown as Awaited<ReturnType<typeof sqlite3InitModule>>);
  const db = new SaulDatabase();
  await expect(db.execute({ type: 'DB_GET_HISTORY', payload: {} })).rejects.toThrow(
    'Persistent storage is unavailable. History was not saved. OPFS denied',
  );
  expect(memoryDb).not.toHaveBeenCalled();
  install.mockResolvedValue({
    OpfsSAHPoolDb: class {
      exec = exec;
      selectValue = () => 1;
      selectObjects = () => [];
      close = vi.fn();
    },
  });
  await expect(db.execute({ type: 'DB_GET_HISTORY', payload: {} })).resolves.toEqual([]);
  expect(install).toHaveBeenCalledTimes(2);
  expect(exec).toHaveBeenCalledWith('PRAGMA foreign_keys = ON');
});
