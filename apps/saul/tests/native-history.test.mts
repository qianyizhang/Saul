import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('a loaded history runtime retains its schema when a later build replaces its source files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'history-runtime-'));
  try {
    for (const name of ['history.mjs', 'history.sql'])
      await copyFile(new URL('../.build/native/' + name, import.meta.url), join(root, name));
    const script = `
      import { unlinkSync } from 'node:fs';
      import { join } from 'node:path';
      import { pathToFileURL } from 'node:url';
      const root = process.argv[1];
      const { SharedHistory } = await import(pathToFileURL(join(root, 'history.mjs')).href);
      unlinkSync(join(root, 'history.sql'));
      const history = new SharedHistory(join(root, 'data'));
      console.log(history.connection.selectValue('PRAGMA user_version'));
      history.connection.close();
    `;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script, root], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      encoding: 'utf8',
    });
    expect(output.trim()).toBe('4');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
