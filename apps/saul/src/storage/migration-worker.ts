import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url';
let pool:
  | Awaited<ReturnType<Awaited<ReturnType<typeof sqlite3InitModule>>['installOpfsSAHPoolVfs']>>
  | undefined;
self.onmessage = async ({ data }: MessageEvent<'export' | 'remove'>) => {
  try {
    const directory = await navigator.storage.getDirectory();
    if (data === 'remove') {
      if (pool) {
        await pool.removeVfs();
        pool = undefined;
      }
      try {
        await directory.removeEntry('saul-opfs', { recursive: true });
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error;
      }
      self.postMessage({});
      return;
    }
    try {
      await directory.getDirectoryHandle('saul-opfs');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        self.postMessage({});
        return;
      }
      throw error;
    }
    const sqlite = await (
      sqlite3InitModule as unknown as (options: {
        locateFile: () => string;
      }) => ReturnType<typeof sqlite3InitModule>
    )({ locateFile: () => wasmUrl });
    pool = await sqlite.installOpfsSAHPoolVfs({ directory: '/saul-opfs' });
    const names = pool.getFileNames();
    if (names.some((name) => name !== '/saul.sqlite3'))
      throw new Error(
        'Unknown files in the old history store. Migration stopped without deleting them.',
      );
    const bytes = names.includes('/saul.sqlite3')
      ? await pool.exportFile('/saul.sqlite3')
      : undefined;
    self.postMessage({ bytes });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
