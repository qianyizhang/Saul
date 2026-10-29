import { BOARD_URI } from '../.build/native/board-resource.mjs';
import { afterEach, expect, it } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { request } from 'node:http';
import { createBoardService } from '../native/board-service.mts';
import { startBoardWeb } from '../.build/native/board-http.mjs';
import { Recorder, snapshot } from '../native/diagnostic-events.mts';
import { LogStore } from '../native/diagnostic-store.mts';
import { MCP_TOOLS } from '../native/app-protocol.mts';
const roots: string[] = [];
afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});
function service() {
  const logRoot = mkdtempSync('/private/tmp/saul-board-observability-');
  roots.push(logRoot);
  return createBoardService({ logRoot, resourceUri: BOARD_URI });
}
function value(result: Awaited<ReturnType<ReturnType<typeof createBoardService>['call']>>) {
  if (!('structuredContent' in result)) throw new Error(JSON.stringify(result));
  return result.structuredContent as Record<string, unknown>;
}
it('retains exact live observations, writes metadata, and explicitly captures only one interaction', async () => {
  const board = service();
  expect((value(await board.call('diagnostics_tools', {})).tools as unknown[]).length).toBe(
    MCP_TOOLS.length,
  );
  const log = new Recorder('app');
  const target = crypto.randomUUID();
  const event = log.record(target, 'ui/message', 'App → Host', 'request', 'sending', {
    text: 'PRIVATE SELECTED TEXT',
    approvalToken: 'SECRET',
    input_tokens: 42,
  });
  await board.call('diagnostics_append', { event });
  await board.call('diagnostics_append', { event });
  const other = log.record(crypto.randomUUID(), 'ui/message', 'App → Host', 'request', 'sending', {
    text: 'UNRELATED PRIVATE TEXT',
  });
  await board.call('diagnostics_append', { event: other });
  const disk = readFileSync(join(board.store.directory, 'app.jsonl'), 'utf8');
  expect(disk).not.toContain('PRIVATE');
  expect(disk).not.toContain('SECRET');
  expect(disk.trim().split('\n')).toHaveLength(2);
  expect(value(await board.call('diagnostics_event', { id: event.id }))).toEqual({ event });
  expect(event.payload.text).toContain('42');
  expect(event.payload.text).not.toContain('SECRET');
  const captured = value(await board.call('diagnostics_capture', { interaction: target }));
  const body = readFileSync(String(captured.path), 'utf8');
  expect(body).toContain('PRIVATE SELECTED TEXT');
  expect(body).not.toContain('UNRELATED');
  expect(body).not.toContain('SECRET');
  expect(captured.eventCount).toBe(1);
  expect(
    await board.call('diagnostics_capture', { interaction: crypto.randomUUID() }),
  ).toMatchObject({ isError: true });
  expect(await board.call('diagnostics_events', { limit: 21 })).toMatchObject({ isError: true });
  expect(
    readdirSync(board.store.directory).filter((name) => name.startsWith('capture-')),
  ).toHaveLength(1);
  expect(snapshot({ outputTokens: 5, token: 'masked' })).toMatchObject({ redacted: true });
});
it('standalone HTTP uses the same operation registry and rejects cross-origin, missing-token and oversize requests', async () => {
  const board = service();
  const local = await startBoardWeb({ service: board });
  try {
    const token = new URL(local.url).hash.slice(1);
    const send = (body: unknown, origin = local.origin, auth = token) =>
      fetch(local.origin + '/api', {
        method: 'POST',
        headers: { Origin: origin, Authorization: `Bearer ${auth}` },
        body: JSON.stringify(body),
      });
    const page = await fetch(local.origin);
    expect(await page.text()).toContain('id="saul-web"');
    expect((await send({ name: 'diagnostics_info' }, 'https://example.com')).status).toBe(403);
    expect((await send({ name: 'diagnostics_info' }, local.origin, 'wrong')).status).toBe(403);
    const info = await (await send({ name: 'diagnostics_info' })).json();
    expect(info.structuredContent.instance).toBe(board.store.instance);
    expect(
      (await send({ name: 'diagnostics_append', arguments: { event: 'x'.repeat(1024 * 1024) } }))
        .status,
    ).toBe(413);
    const rejected = await (await send({ name: 'saul_tabs_edit', arguments: {} })).json();
    expect(rejected.isError).toBe(true);
  } finally {
    await new Promise<void>((resolve, reject) =>
      local.server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it('standalone HTTP preserves Unicode split across network chunks', async () => {
  const board = service();
  const local = await startBoardWeb({ service: board });
  try {
    const log = new Recorder('app');
    const event = log.record(
      crypto.randomUUID(),
      'ui/message',
      'App → Host',
      'request',
      'sending',
      {
        text: 'café 中文 🧪',
      },
    );
    const body = Buffer.from(JSON.stringify({ name: 'diagnostics_append', arguments: { event } }));
    const split = body.indexOf(Buffer.from('é')) + 1;
    const result = await new Promise<{ status?: number; body: string }>((resolve, reject) => {
      const outgoing = request(
        local.origin + '/api',
        {
          method: 'POST',
          headers: {
            Origin: local.origin,
            Authorization: `Bearer ${new URL(local.url).hash.slice(1)}`,
          },
        },
        (response) => {
          let text = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            text += chunk;
          });
          response.on('end', () => resolve({ status: response.statusCode, body: text }));
        },
      );
      outgoing.on('error', reject);
      outgoing.write(body.subarray(0, split));
      setTimeout(() => outgoing.end(body.subarray(split)), 30);
    });
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).not.toMatchObject({ isError: true });
    expect(value(await board.call('diagnostics_event', { id: event.id }))).toEqual({ event });
  } finally {
    await new Promise<void>((resolve) => local.server.close(() => resolve()));
  }
});

it('retention prunes only recognized inactive sessions and preserves live, unknown and linked data', () => {
  const root = mkdtempSync('/private/tmp/saul-retention-');
  roots.push(root);
  const app = join(root, 'saul-tab-board');
  mkdirSync(app);
  const session = (started: number, pid = 2147483647) => {
    const path = join(app, crypto.randomUUID());
    mkdirSync(path);
    writeFileSync(
      join(path, 'session.json'),
      JSON.stringify({ owner: 'saul-tab-board', pid, started }),
    );
    return path;
  };
  const now = Date.now();
  const recent = Array.from({ length: 10 }, (_, index) => session(now - index * 1000));
  const old = session(now - 8 * 86400_000);
  const live = session(now - 8 * 86400_000, process.pid);
  const unknown = session(now - 8 * 86400_000);
  writeFileSync(join(unknown, 'keep.txt'), 'unrecognized content');
  const linked = join(app, crypto.randomUUID());
  symlinkSync(unknown, linked);
  const store = new LogStore('saul-tab-board', root);
  expect(store.error).toBeUndefined();
  expect(recent.map((path) => existsSync(path))).toEqual([...Array(8).fill(true), false, false]);
  expect(existsSync(old)).toBe(false);
  for (const path of [live, unknown, linked]) expect(existsSync(path)).toBe(true);
});
it('storage failure retains live observations and rejects captures without changing actions', async () => {
  const root = mkdtempSync('/private/tmp/saul-storage-failure-');
  roots.push(root);
  writeFileSync(join(root, 'saul-tab-board'), 'not a directory');
  const board = createBoardService({ resourceUri: BOARD_URI, logRoot: root });
  const log = new Recorder('app');
  const event = log.record(crypto.randomUUID(), 'ui/message', 'App → Host', 'request', 'sending', {
    text: 'retained',
  });
  expect(value(await board.call('diagnostics_append', { event }))).toEqual({ stored: false });
  expect(value(await board.call('diagnostics_event', { id: event.id }))).toEqual({ event });
  expect(value(await board.call('diagnostics_info'))).toMatchObject({ health: 'memory-only' });
  expect(await board.call('diagnostics_capture', { interaction: event.interaction })).toMatchObject(
    { isError: true },
  );
});
