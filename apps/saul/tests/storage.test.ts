import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SharedHistory } from '../native/history.mts';
import type { RunInput, Submission } from '../src/types/storage';
const roots: string[] = [];
const open: SharedHistory[] = [];
function history() {
  const dir = mkdtempSync(join(tmpdir(), 'shared-history-'));
  roots.push(dir);
  const store = new SharedHistory(dir);
  open.push(store);
  return store;
}
afterEach(() => {
  for (const store of open.splice(0)) store.close();
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function submission(id = 'selection'): Submission {
  return {
    submissionId: id,
    snapshot: {
      id,
      text: '你好 gradient',
      page: { url: 'https://example.test/page', title: 'Source' },
      anchor: { exact: '你好 gradient', prefix: '', suffix: '' },
      viewport: { x: 0, y: 0, width: 0, height: 0, scrollX: 0, scrollY: 0 },
      capturedAt: 1,
    },
    input: {
      provider: 'openai-compatible',
      remote: { baseUrl: 'https://example.test/v1', model: 'model', temperature: 0.3 },
      local: { temperature: 0.3, topK: 3 },
      systemPrompt: 'Frozen instructions',
      userPrompt: 'Frozen query',
      context: {
        selection: '你好 gradient',
        pageTitle: 'Source',
        pageUrl: 'https://example.test/page',
      },
    } satisfies RunInput,
    regenerate: false,
  };
}
async function complete(store: SharedHistory, frozen?: { query: string; response: string }) {
  const payload = submission();
  if (frozen) payload.input.userPrompt = frozen.query;
  const result = await store.browser.execute({ type: 'DB_SUBMIT', payload });
  const id = result.run!.id;
  await store.browser.execute({ type: 'DB_CLAIM', payload: { runId: id } });
  await store.browser.execute({ type: 'DB_SAVING', payload: { runId: id } });
  await store.browser.execute({
    type: 'DB_FINISH',
    payload: {
      runId: id,
      raw: frozen?.response ?? 'A <term note="Slope">gradient</term>.',
      status: 'completed',
      latencyMs: 5,
    },
  });
  return id;
}

const historyContract = JSON.parse(
  readFileSync(new URL('../../../contracts/fixtures/history.json', import.meta.url), 'utf8'),
) as {
  version: number;
  query: string;
  response: string;
  cases: {
    name: string;
    kind: 'repeat-save' | 'delete' | 'active-delete' | 'newer-schema';
    entries?: number;
    schemaVersion?: number;
  }[];
};
it.each(historyContract.cases)('shared History contract: $name', async (fixture) => {
  expect(historyContract.version).toBe(1);
  const store = history();
  if (fixture.kind === 'newer-schema') {
    store.connection.exec(`PRAGMA user_version=${fixture.schemaVersion}`);
    expect(() => new SharedHistory(store.directory)).toThrow('Unsupported shared history version');
    return;
  }
  if (fixture.kind === 'active-delete') {
    const id = randomUUID();
    store.connection.exec({
      sql: 'INSERT INTO ez_entry(id,created_at,data) VALUES (?,?,?)',
      bind: [
        id,
        1,
        JSON.stringify({
          schemaVersion: 1,
          id,
          query: historyContract.query,
          response: '',
          model: 'fixture',
          status: 'pending',
        }),
      ],
    });
    await expect(
      store.browser.execute({ type: 'DB_DELETE_SELECTION', payload: { selectionId: 'ez:' + id } }),
    ).rejects.toThrow('Stop the running request in EZ');
    expect(Number(store.connection.selectValue('SELECT count(*) FROM ez_entry'))).toBe(
      fixture.entries,
    );
    return;
  }
  const runId = await complete(store, historyContract);
  if (fixture.kind === 'repeat-save') {
    await store.browser.execute({
      type: 'DB_FINISH',
      payload: { runId, status: 'completed', raw: historyContract.response, latencyMs: 5 },
    });
  } else if (fixture.kind === 'delete') {
    await store.browser.execute({
      type: 'DB_DELETE_SELECTION',
      payload: { selectionId: 'selection' },
    });
    // Late completion cannot recreate a deleted browser attempt.
    await store.browser.execute({
      type: 'DB_FINISH',
      payload: { runId, status: 'completed', raw: historyContract.response, latencyMs: 5 },
    });
  } else throw new Error('Unknown History contract case');
  const reopened = new SharedHistory(store.directory);
  open.push(reopened);
  const rows = await reopened.browser.execute({ type: 'DB_GET_HISTORY', payload: {} });
  expect(rows).toHaveLength(fixture.entries!);
  if (rows.length) {
    expect(rows[0]!.responseRaw).toBe(historyContract.response);
    expect(rows[0]!.latest.inspection!.userPrompt).toBe(historyContract.query);
  }
});
it('shares browser history across connections with exact frozen prompts, full-text search and durable deletion', async () => {
  const first = history();
  const run = await complete(first);
  const second = new SharedHistory(first.directory);
  open.push(second);
  const rows = await second.browser.execute({
    type: 'DB_GET_HISTORY',
    payload: { searchQuery: 'Slope' },
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]!.latest.id).toBe(run);
  expect(rows[0]!.latest.inspection!.systemPrompt).toBe('Frozen instructions');
  await second.browser.execute({
    type: 'DB_DELETE_SELECTION',
    payload: { selectionId: 'selection' },
  });
  expect(await first.browser.execute({ type: 'DB_GET_HISTORY', payload: {} })).toEqual([]);
});
it('projects native entries into the same ordered/searchable library, including images, bookmarks and deletion', async () => {
  const store = history();
  await complete(store);
  const id = randomUUID();
  const entry = {
    schemaVersion: 1,
    id,
    createdAt: '2026-11-04T00:00:00Z',
    mode: 'Ask',
    query: 'Native prompt',
    response: 'Native answer 你好',
    model: 'native-model',
    effort: 'low',
    status: 'completed',
    instructions: 'Native instructions',
    recipeSnapshot: { id: randomUUID(), name: 'Native action' },
    inputValues: { text: 'native input' },
  };
  store.connection.exec({
    sql: 'INSERT INTO ez_entry(id,created_at,data,image) VALUES (?,?,?,?)',
    bind: [id, 2, JSON.stringify(entry), new Uint8Array([1, 2, 3])],
  });
  const rows = await store.browser.execute({ type: 'DB_GET_HISTORY', payload: {} });
  expect(rows.map((r) => r.selectedText)).toEqual(['native input', '你好 gradient']);
  expect(
    await store.browser.execute({ type: 'DB_IMAGE', payload: { selectionId: 'ez:' + id } }),
  ).toEqual({ data: 'AQID', mediaType: 'image/png' });
  await store.browser.execute({
    type: 'DB_SET_BOOKMARK',
    payload: { selectionId: 'ez:' + id, bookmarked: true },
  });
  expect(
    await store.browser.execute({
      type: 'DB_GET_HISTORY',
      payload: { bookmarksOnly: true, searchQuery: '你好' },
    }),
  ).toHaveLength(1);
  await store.browser.execute({
    type: 'DB_DELETE_SELECTION',
    payload: { selectionId: 'ez:' + id },
  });
  expect(store.connection.selectValue('SELECT count(*) FROM ez_entry')).toBe(0);
});
it('imports old SQLite records once, verifies them before acknowledging, and removes temporary imports', async () => {
  const source = history();
  await complete(source);
  source.connection.exec('DROP TABLE ez_entry;DROP TABLE history_migration;PRAGMA user_version=2;');
  const bytes = readFileSync(join(source.directory, 'history.sqlite3'));
  const target = history();
  const id = randomUUID();
  await target.run({ operation: 'import-begin', id });
  await target.run({ operation: 'import-chunk', id, offset: 0, data: bytes.toString('base64') });
  expect(await target.run({ operation: 'import-finish', id, size: bytes.length })).toEqual({
    imported: true,
  });
  expect(
    await target.browser.execute({ type: 'DB_GET_HISTORY', payload: { searchQuery: 'Slope' } }),
  ).toHaveLength(1);
  await target.browser.execute({ type: 'DB_CLEAR_HISTORY', payload: undefined });
  expect(await target.run({ operation: 'import-begin', id })).toEqual({ imported: true });
  expect(readdirSync(target.directory).some((x) => x.startsWith('.history-import-'))).toBe(false);
});
it('rejects incomplete imports and newer schemas without silently saving elsewhere', async () => {
  const store = history();
  const id = randomUUID();
  await store.run({ operation: 'import-begin', id });
  await expect(store.run({ operation: 'import-finish', id, size: 12 })).rejects.toThrow(
    'incomplete',
  );
  expect(store.connection.selectValue('SELECT count(*) FROM history_migration')).toBe(0);
  store.connection.exec('PRAGMA user_version=99');
  expect(() => new SharedHistory(store.directory)).toThrow('Unsupported');
});

it('recovery is scoped to one Chrome profile and does not interrupt another profile', async () => {
  const store = history();
  const a = '11111111-1111-1111-1111-111111111111',
    b = '22222222-2222-2222-2222-222222222222';
  const result = (await store.run({
    operation: 'db',
    requestId: randomUUID(),
    owner: a,
    message: { type: 'DB_SUBMIT', payload: submission() },
  })) as { run: { id: string } };
  await store.run({
    operation: 'db',
    requestId: randomUUID(),
    owner: b,
    message: { type: 'DB_RECOVER', payload: undefined },
  });
  expect(
    store.connection.selectValue('SELECT status FROM llm_run WHERE id=?', [result.run.id]),
  ).toBe('queued');
  await store.run({
    operation: 'db',
    requestId: randomUUID(),
    owner: a,
    message: { type: 'DB_RECOVER', payload: undefined },
  });
  expect(
    store.connection.selectValue('SELECT status FROM llm_run WHERE id=?', [result.run.id]),
  ).toBe('interrupted');
});

it('refuses clearing shared history while another app owns a pending request', async () => {
  const store = history();
  await complete(store);
  const id = randomUUID();
  store.connection.exec({
    sql: 'INSERT INTO ez_entry(id,created_at,data) VALUES (?,?,?)',
    bind: [id, 2, JSON.stringify({ status: 'pending' })],
  });
  await expect(
    store.browser.execute({ type: 'DB_CLEAR_HISTORY', payload: undefined }),
  ).rejects.toThrow('Stop active requests');
  expect(store.connection.selectValue('SELECT count(*) FROM selection')).toBe(1);
  expect(store.connection.selectValue('SELECT count(*) FROM ez_entry')).toBe(1);
});

it('blocks deletion of another profile’s active passage and permits its owner to delete it', async () => {
  const store = history();
  const owner = '11111111-1111-1111-1111-111111111111';
  const other = '22222222-2222-2222-2222-222222222222';
  await store.run({
    operation: 'db',
    requestId: randomUUID(),
    owner,
    message: { type: 'DB_SUBMIT', payload: submission() },
  });
  await expect(
    store.run({
      operation: 'db',
      requestId: randomUUID(),
      owner: other,
      message: { type: 'DB_DELETE_SELECTION', payload: { selectionId: 'selection' } },
    }),
  ).rejects.toThrow('browser profile');
  expect(store.connection.selectValue('SELECT count(*) FROM selection')).toBe(1);
  await store.run({
    operation: 'db',
    requestId: randomUUID(),
    owner,
    message: { type: 'DB_DELETE_SELECTION', payload: { selectionId: 'selection' } },
  });
  expect(store.connection.selectValue('SELECT count(*) FROM selection')).toBe(0);
});

it('returns the same queued handoff and transition acknowledgements after a lost reply', async () => {
  const store = history();
  const owner = randomUUID();
  const requestId = randomUUID();
  const request = {
    operation: 'db' as const,
    owner,
    requestId,
    message: { type: 'DB_SUBMIT' as const, payload: submission() },
  };
  const first = structuredClone(await store.run(request)) as {
    run: { id: string; input: RunInput };
  };
  request.message.payload.input.systemPrompt = 'Changed after submission';
  const repeated = (await store.run(request)) as typeof first;
  expect(repeated.run).toEqual(first.run);
  expect(store.connection.selectValue('SELECT count(*) FROM llm_run')).toBe(1);
  const claim = {
    operation: 'db' as const,
    owner,
    requestId: randomUUID(),
    message: { type: 'DB_CLAIM' as const, payload: { runId: first.run.id } },
  };
  expect(await store.run(claim)).toBe(true);
  expect(await store.run(claim)).toBe(true);
  expect(await store.run({ ...claim, requestId: randomUUID() })).toBe(false);
  const saving = {
    ...claim,
    requestId: randomUUID(),
    message: { type: 'DB_SAVING' as const, payload: claim.message.payload },
  };
  expect(await store.run(saving)).toBe(true);
  expect(await store.run(saving)).toBe(true);
  expect(await store.run({ ...saving, requestId: randomUUID() })).toBe(false);
});
