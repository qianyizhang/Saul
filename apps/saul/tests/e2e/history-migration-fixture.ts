// One-time legacy input, compiled only into disposable migration-test snapshots.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url';
import type { SqlDatabase } from '../../src/storage/sql';
import { migrate } from '../../src/storage/schema';
self.onmessage = async () => {
  try {
    const sqlite = await (
      sqlite3InitModule as unknown as (options: {
        locateFile: () => string;
      }) => ReturnType<typeof sqlite3InitModule>
    )({ locateFile: () => wasmUrl });
    const pool = await sqlite.installOpfsSAHPoolVfs({ directory: '/saul-opfs' });
    const db = new pool.OpfsSAHPoolDb('/saul.sqlite3');
    // This fixture reads only text/integer columns; the vendor also declares unrelated blob types.
    migrate(db as unknown as SqlDatabase);
    db.exec(`INSERT INTO page(id,url,title,first_seen_at,last_seen_at) VALUES ('old-page','https://old.test/page','Old source',1,1);
    INSERT INTO selection(id,page_id,text,created_at) VALUES ('old-selection','old-page','Original 你好 selection',1);
    INSERT INTO llm_run(id,selection_id,widget_id,provider,model,prompt_version,prompt_raw,context_json,response_raw,status,created_at,viewed_at) VALUES ('old-run','old-selection','explain','openai-compatible','old-model','1','Original instructions','{}','Original saved answer','completed',2,3);
    INSERT INTO bookmark VALUES ('old-selection',4);`);
    db.close();
    pool.pauseVfs();
    self.postMessage({ success: true });
  } catch (error) {
    self.postMessage({ success: false, error: String(error) });
  }
};
