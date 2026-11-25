import { executeHistory } from './helpers/history-db';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HistoryConnection, SharedHistory } from '../native/storage/history.mts';
import { StorageConnection, StorageDisconnected } from '../src/native/storage-connection';
import { requestHistory } from '../src/native/storage-client';
import { storagePort } from './helpers/storage-port';
import type { StorageHelperRequest } from '../shared/protocol/storage-protocol.mts';
import { createHistoryRequest } from '../shared/protocol/history-protocol.mts';
import type { DbRequest, RunInput, Submission } from '../shared/protocol/history-types.ts';
const roots: string[] = [];
const open: SharedHistory[] = [];
async function valueOf(store: SharedHistory, request: unknown) {
  return (await store.run(request)).value ?? undefined;
}
function history() {
  const dir = mkdtempSync(join(tmpdir(), 'shared-history-'));
  roots.push(dir);
  const store = new SharedHistory(dir);
  open.push(store);
  return store;
}
afterEach(() => {
  vi.unstubAllGlobals();
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
  const result = await executeHistory(store, { type: 'DB_SUBMIT', payload });
  const id = result.run!.id;
  await executeHistory(store, { type: 'DB_CLAIM', payload: { runId: id } });
  await executeHistory(store, { type: 'DB_SAVING', payload: { runId: id } });
  await executeHistory(store, {
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
      executeHistory(store, { type: 'DB_DELETE_SELECTION', payload: { selectionId: 'ez:' + id } }),
    ).rejects.toThrow('Stop the running request in EZ');
    expect(Number(store.connection.selectValue('SELECT count(*) FROM ez_entry'))).toBe(
      fixture.entries,
    );
    return;
  }
  const runId = await complete(store, historyContract);
  if (fixture.kind === 'repeat-save') {
    await executeHistory(store, {
      type: 'DB_FINISH',
      payload: { runId, status: 'completed', raw: historyContract.response, latencyMs: 5 },
    });
  } else if (fixture.kind === 'delete') {
    await executeHistory(store, {
      type: 'DB_DELETE_SELECTION',
      payload: { selectionId: 'selection' },
    });
    // Late completion cannot recreate a deleted browser attempt.
    await executeHistory(store, {
      type: 'DB_FINISH',
      payload: { runId, status: 'completed', raw: historyContract.response, latencyMs: 5 },
    });
  } else throw new Error('Unknown History contract case');
  const reopened = new SharedHistory(store.directory);
  open.push(reopened);
  const rows = await executeHistory(reopened, { type: 'DB_GET_HISTORY', payload: {} });
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
  const rows = await executeHistory(second, {
    type: 'DB_GET_HISTORY',
    payload: { searchQuery: 'Slope' },
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]!.latest.id).toBe(run);
  expect(rows[0]!.latest.inspection!.systemPrompt).toBe('Frozen instructions');
  await executeHistory(second, {
    type: 'DB_DELETE_SELECTION',
    payload: { selectionId: 'selection' },
  });
  expect(await executeHistory(first, { type: 'DB_GET_HISTORY', payload: {} })).toEqual([]);
});
it('returns one history snapshot when another connection deletes a listed passage', async () => {
  const reading = history();
  reading.connection.exec('PRAGMA journal_mode=WAL');
  await complete(reading);
  const writing = new SharedHistory(reading.directory);
  open.push(writing);
  const select = reading.connection.selectObjects.bind(reading.connection);
  let deleted = false;
  const interleave = vi
    .spyOn(reading.connection, 'selectObjects')
    .mockImplementation((sql, bind) => {
      const rows = select(sql, bind);
      if (!deleted && rows[0]?.app === 'saul') {
        writing.connection.exec("DELETE FROM selection WHERE id='selection'");
        deleted = true;
      }
      return rows;
    });
  const request = { type: 'DB_GET_HISTORY', payload: {} } as const;
  try {
    expect((await executeHistory(reading, request)).map((row) => row.selectionId)).toEqual([
      'selection',
    ]);
    expect(deleted).toBe(true);
    expect(await executeHistory(reading, request)).toEqual([]);
  } finally {
    interleave.mockRestore();
  }
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
    durationSeconds: 1.1234567,
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
  const page = (await valueOf(
    store,
    createHistoryRequest(randomUUID(), randomUUID(), {
      type: 'DB_HISTORY_PAGE',
      payload: { limit: 10 },
    }),
  )) as { items: { selectedText: string; latest: { latencyMs?: number } }[] };
  expect(page.items.map((row) => row.selectedText)).toEqual(['native input', '你好 gradient']);
  expect(page.items[0]?.latest.latencyMs).toBeCloseTo(1123.4567);
  expect(
    await executeHistory(store, { type: 'DB_IMAGE', payload: { selectionId: 'ez:' + id } }),
  ).toEqual({ data: 'AQID', mediaType: 'image/png' });
  await executeHistory(store, {
    type: 'DB_SET_BOOKMARK',
    payload: { selectionId: 'ez:' + id, bookmarked: true },
  });
  expect(
    await executeHistory(store, {
      type: 'DB_GET_HISTORY',
      payload: { bookmarksOnly: true, searchQuery: '你好' },
    }),
  ).toHaveLength(1);
  await executeHistory(store, {
    type: 'DB_DELETE_SELECTION',
    payload: { selectionId: 'ez:' + id },
  });
  expect(store.connection.selectValue('SELECT count(*) FROM ez_entry')).toBe(1);
  expect(
    await executeHistory(store, {
      type: 'DB_GET_HISTORY',
      payload: { searchQuery: 'Native prompt' },
    }),
  ).toEqual([]);
});
it('scopes recovery by profile and requires even the owner to settle an active passage before masking', async () => {
  const store = history();
  const owner = randomUUID();
  const other = randomUUID();
  const call = (who: string, message: DbRequest) =>
    valueOf(store, createHistoryRequest(who, randomUUID(), message));
  const queued = (await call(owner, { type: 'DB_SUBMIT', payload: submission() })) as {
    run: { id: string };
  };
  await call(other, { type: 'DB_RECOVER', payload: undefined });
  const state = () =>
    store.connection.selectValue('SELECT status FROM llm_run WHERE id=?', [queued.run.id]);
  expect(state()).toBe('queued');
  for (const who of [owner, other])
    await expect(
      call(who, { type: 'DB_DELETE_SELECTION', payload: { selectionId: 'selection' } }),
    ).rejects.toThrow(/stop|active/i);
  await call(owner, { type: 'DB_RECOVER', payload: undefined });
  expect(state()).toBe('interrupted');
  await call(owner, { type: 'DB_DELETE_SELECTION', payload: { selectionId: 'selection' } });
  expect(await call(owner, { type: 'DB_GET_HISTORY', payload: {} })).toEqual([]);
  expect(store.connection.selectValue('SELECT count(*) FROM selection')).toBe(1);
});

it('resolves identical writes after a lost reply and rejects changed input under the same identity', async () => {
  const store = history();
  const owner = randomUUID();
  const payload = submission();
  delete payload.input.local;
  const request = createHistoryRequest(owner, randomUUID(), { type: 'DB_SUBMIT', payload });
  const accepted = (await valueOf(store, request)) as { run: { id: string } };
  expect(await valueOf(store, request)).toEqual(accepted);
  expect(store.connection.selectValue('SELECT count(*) FROM llm_run')).toBe(1);
  const different = createHistoryRequest(owner, request.operationId, {
    type: 'DB_SUBMIT',
    payload: { ...payload, input: { ...payload.input, systemPrompt: 'changed' } },
  });
  await expect(valueOf(store, different)).rejects.toThrow();
  for (const type of ['DB_CLAIM', 'DB_SAVING'] as const) {
    const transition = createHistoryRequest(owner, randomUUID(), {
      type,
      payload: { runId: accepted.run.id },
    });
    expect(await valueOf(store, transition)).toBe(true);
    expect(await valueOf(store, transition)).toBe(true);
    expect(await valueOf(store, { ...transition, operationId: randomUUID() })).toBe(false);
  }
});

it('rejects malformed Reading lifecycle payloads before native history changes', async () => {
  const store = history();
  const owner = randomUUID();
  const run = (type: string, payload: unknown) =>
    valueOf(store, createHistoryRequest(owner, randomUUID(), { type, payload } as DbRequest));
  const payload = submission();
  for (const invalid of [
    { ...payload, regenerate: 'false' },
    { ...payload, snapshot: { ...payload.snapshot, viewport: { width: 1 } } },
    {
      ...payload,
      input: { ...payload.input, context: { ...payload.input.context, selection: 1 } },
    },
    {
      ...payload,
      input: { ...payload.input, remote: { ...payload.input.remote, temperature: 'hot' } },
    },
  ]) {
    await expect(run('DB_SUBMIT', invalid)).rejects.toThrow(/invalid/i);
    expect(store.connection.selectValue('SELECT count(*) FROM page')).toBe(0);
  }
  const { run: queued } = (await run('DB_SUBMIT', payload)) as { run: { id: string } };
  const runId = queued.id;
  const row = () =>
    store.connection.selectObject('SELECT status,response_raw,latency_ms FROM llm_run WHERE id=?', [
      runId,
    ]);
  expect(row()?.status).toBe('queued');
  await expect(run('DB_CLAIM', {})).rejects.toThrow(/invalid/i);
  expect(row()?.status).toBe('queued');
  await expect(run('DB_CLAIM', { runId })).resolves.toBe(true);
  await expect(run('DB_CHECKPOINT', { runId })).rejects.toThrow(/invalid/i);
  await expect(run('DB_CHECKPOINT', { runId, raw: false })).rejects.toThrow(/invalid/i);
  await expect(run('DB_CHECKPOINT', { runId, raw: 'partial' })).resolves.toBeUndefined();
  await expect(run('DB_SAVING', { runId: 9 })).rejects.toThrow(/invalid/i);
  expect(row()).toMatchObject({ status: 'running', response_raw: 'partial', latency_ms: null });
  await expect(run('DB_SAVING', { runId })).resolves.toBe(true);
  const finish = { runId, status: 'completed', latencyMs: 8, raw: 'final' };
  for (const invalid of [
    { ...finish, status: 'not-a-status' },
    { ...finish, status: 'running' },
    { ...finish, latencyMs: 'oops' },
    { ...finish, latencyMs: -1 },
    { ...finish, latencyMs: Infinity },
    { ...finish, latencyMs: undefined },
  ]) {
    await expect(run('DB_FINISH', invalid)).rejects.toThrow(/invalid/i);
    expect(row()).toMatchObject({ status: 'saving', response_raw: 'partial', latency_ms: null });
  }
  await expect(run('DB_FINISH', finish)).resolves.toBe(true);
  expect(row()).toMatchObject({ status: 'completed', response_raw: 'final', latency_ms: 8 });
});

it('rejects malformed lifecycle acknowledgements even when native storage committed', async () => {
  const store = history();
  const owner = randomUUID();
  const makeRequest = (type: string, payload: unknown) => ({
    action: 'history' as const,
    request: createHistoryRequest(owner, randomUUID(), { type, payload } as DbRequest),
  });
  let malformed: unknown;
  let requests = 0;
  vi.stubGlobal('chrome', {
    runtime: {
      connectNative: storagePort<StorageHelperRequest>(async (_host, { request }) => {
        if (request.action !== 'history') throw new Error('Unexpected request');
        requests++;
        await store.run(request.request);
        return { event: { type: 'result', value: malformed } };
      }),
    },
  });
  const transport = new StorageConnection();
  const rejectReply = async (type: string, payload: unknown, value: unknown) => {
    malformed = value;
    const result = transport.request(makeRequest(type, payload));
    await expect(result).rejects.toThrow('The write may have been applied.');
    await expect(result).rejects.not.toBeInstanceOf(StorageDisconnected);
  };
  try {
    const payload = submission();
    await rejectReply('DB_SUBMIT', payload, {
      passageId: payload.snapshot.id,
      run: {
        id: 'run',
        selectionId: payload.snapshot.id,
        pageUrl: payload.snapshot.page.url,
        input: { ...payload.input, context: { ...payload.input.context, pageTitle: 7 } },
      },
    });
    const runId = store.connection.selectValue('SELECT id FROM llm_run');
    expect(runId).toEqual(expect.any(String));
    await rejectReply('DB_CLAIM', { runId }, 'true');
    await rejectReply('DB_CHECKPOINT', { runId, raw: 'partial' }, false);
    await rejectReply('DB_SAVING', { runId }, 1);
    await rejectReply('DB_FINISH', { runId, status: 'completed', latencyMs: 8 }, { saved: true });
    expect(requests).toBe(5);
    expect(store.connection.selectObject('SELECT status,response_raw FROM llm_run')).toMatchObject({
      status: 'completed',
      response_raw: 'partial',
    });
  } finally {
    transport.close();
  }

  // The offscreen client validates the bridge reply independently of native-port callers.
  vi.stubGlobal('chrome', {
    runtime: {
      connect: () => {
        let receive: (event: unknown) => void;
        return {
          onMessage: { addListener: (listener: typeof receive) => (receive = listener) },
          onDisconnect: { addListener: vi.fn() },
          postMessage: () => receive({ type: 'result' }),
          disconnect: vi.fn(),
        };
      },
    },
  });
  await expect(
    requestHistory(makeRequest('DB_CHECKPOINT', { runId: 'run', raw: '' })),
  ).rejects.toThrow('The write may have been applied.');
});

it('converts the shared v4 fixture atomically and preserves its bookmark and frozen input on reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'history-cutover-'));
  roots.push(directory);
  const old = new HistoryConnection(join(directory, 'history.sqlite3'));
  const sql = (file: string) =>
    readFileSync(new URL('../../../contracts/fixtures/' + file, import.meta.url), 'utf8');
  old.exec(sql('history-v4.sql'));
  old.exec(sql('history-v4-record.sql'));
  // A real failure after the bookmark column change must leave v4 wholly intact.
  old.exec('CREATE TABLE history_event (unrelated TEXT)');
  expect(() => new SharedHistory(directory)).toThrow();
  expect(old.selectValue('PRAGMA user_version')).toBe(4);
  expect(old.selectValue('SELECT created_at FROM bookmark')).toBe(4);
  expect(old.selectObjects('PRAGMA table_info(selection)').map((row) => row.name)).not.toContain(
    'bookmarked_at',
  );
  old.exec('DROP TABLE history_event');
  old.close();
  const store = new SharedHistory(directory);
  open.push(store);
  const owner = randomUUID();
  const call = (command: Parameters<typeof createHistoryRequest>[2]) =>
    valueOf(store, createHistoryRequest(owner, randomUUID(), command));
  expect(
    await call({ type: 'DB_GET_HISTORY', payload: { searchQuery: 'Legacy', bookmarksOnly: true } }),
  ).toMatchObject([{ selectionId: 'shared-selection', responseRaw: 'Legacy answer 🌱' }]);
  expect(
    await call({
      type: 'DB_INPUT',
      payload: { selectionId: 'shared-selection', runId: 'shared-run' },
    }),
  ).toMatchObject({ userPrompt: 'Exact old prompt' });
  await call({
    type: 'DB_SET_BOOKMARK',
    payload: { selectionId: 'shared-selection', bookmarked: true },
  });
  const reopened = new SharedHistory(directory);
  open.push(reopened);
  expect(reopened.connection.selectValue('SELECT bookmarked_at FROM selection')).toBe(4);
  expect(
    reopened.connection.selectObjects(
      "SELECT name FROM sqlite_schema WHERE name IN ('interaction','bookmark','history_migration')",
    ),
  ).toEqual([]);
  expect(reopened.connection.selectValue('PRAGMA user_version')).toBe(5);
});
