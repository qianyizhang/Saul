import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { annotationStore, annotationAttempts } from '../native/annotation-store.mts';
import {
  retentionMs,
  type AnnotationCapture,
  type AnnotationRequest,
} from '../src/annotations/contract';
import { AnnotationRunner } from '../src/annotations/runner';
import type { SqlDatabase, SqlValue } from '../src/storage/sql';
import type { DbCall, RunInput, DbRequest } from '../src/types/storage';
import { responsesBody } from '../native/responses.mts';
import { validatePlanRequest } from '../native/plan-protocol.mts';
import { validateCall } from '../native/protocol.mts';
const files: string[] = [];
const connections: DatabaseSync[] = [];
afterEach(() => {
  connections.splice(0).forEach((c) => c.close());
  files.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true }));
});
function database(path = ':memory:'): SqlDatabase {
  const c = new DatabaseSync(path);
  connections.push(c);
  c.exec('PRAGMA foreign_keys=ON');
  return {
    exec: (q) => (typeof q === 'string' ? c.exec(q) : c.prepare(q.sql).run(...(q.bind ?? []))),
    selectObjects: (q, b = []) => c.prepare(q).all(...b) as Record<string, SqlValue>[],
    selectObject: (q, b = []) => c.prepare(q).get(...b) as Record<string, SqlValue> | undefined,
    selectValue: (q, b = []) =>
      Object.values(c.prepare(q).get(...b) ?? {})[0] as SqlValue | undefined,
    changes: () => Number(c.prepare('SELECT changes() n').get()!.n),
    transaction: (fn) => {
      c.exec('BEGIN IMMEDIATE');
      try {
        const r = fn();
        c.exec('COMMIT');
        return r;
      } catch (e) {
        c.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
const url = 'https://example.com/page?q=1#section';
const capture: AnnotationCapture = {
  id: 'annotation-one',
  url,
  title: 'Page',
  comment: 'Explain this button',
  target: {
    kind: 'element',
    label: 'Send',
    selector: '#send',
    frame: 'top document',
    rect: { x: 10, y: 20, width: 60, height: 30 },
    viewport: { width: 1000, height: 800, scrollX: 0, scrollY: 0, scale: 1 },
  },
  image: 'data:image/jpeg;base64,YQ==',
};
const request = (operation: AnnotationRequest['operation']): AnnotationRequest => ({
  scope: { urls: [url], ids: [] },
  author: { kind: 'user', name: 'You' },
  operation,
});
it('persists exact URLs, attributed replies, conflicts, retries and seven-day deletion through SQLite', () => {
  const directory = mkdtempSync(join(tmpdir(), 'saul-annotation-'));
  files.push(directory);
  const path = join(directory, 'history.sqlite3');
  let db = database(path);
  annotationStore(db, 'profile', request({ action: 'create', capture }), 100);
  expect(
    annotationStore(db, 'other', request({ action: 'list', url, filter: 'all', offset: 0 }))
      .records,
  ).toEqual([]);
  connections.pop()!.close();
  db = database(path);
  const change = {
    id: capture.id,
    revision: 1,
    operationId: 'reply-once',
    action: 'append' as const,
    text: 'A reply',
  };
  const r = annotationStore(
    db,
    'profile',
    {
      ...request({ action: 'change', changes: [change] }),
      author: { kind: 'agent', name: 'Codex' },
    },
    200,
  );
  expect(r.outcomes![0]!.record!.replyCount).toBe(1);
  expect(
    annotationStore(db, 'profile', request({ action: 'change', changes: [change] }), 300)
      .outcomes![0]!.record!.replyCount,
  ).toBe(1);
  expect(
    annotationStore(
      db,
      'profile',
      request({ action: 'change', changes: [{ ...change, operationId: 'stale' }] }),
      300,
    ).outcomes![0]!.error,
  ).toMatch(/changed/);
  expect(() =>
    annotationStore(db, 'profile', {
      ...request({ action: 'read', id: capture.id, image: true }),
      scope: { urls: ['https://other.test/'], ids: [] },
    }),
  ).toThrow(/scope/);
  const read = () =>
    annotationStore(db, 'profile', request({ action: 'read', id: capture.id, image: true }))
      .record!;
  expect(read().replies[0]!.author.name).toBe('Codex');
  expect(read().image).toBe(capture.image);
  annotationStore(
    db,
    'profile',
    request({
      action: 'change',
      changes: [{ ...change, revision: 2, operationId: 'del', action: 'delete' }],
    }),
    Date.now(),
  );
  expect(
    annotationStore(db, 'profile', request({ action: 'list', url, filter: 'open', offset: 0 }))
      .records,
  ).toEqual([]);
  annotationStore(
    db,
    'profile',
    request({
      action: 'change',
      changes: [{ ...change, revision: 3, operationId: 'restore', action: 'restore' }],
    }),
  );
  expect(read().deletedAt).toBeUndefined();
  const now = Date.now();
  annotationStore(
    db,
    'profile',
    request({
      action: 'change',
      changes: [{ ...change, revision: 4, operationId: 'del2', action: 'delete' }],
    }),
    now,
  );
  expect(
    annotationStore(
      db,
      'profile',
      request({ action: 'list', url, filter: 'deleted', offset: 0 }),
      now + retentionMs + 1,
    ).records,
  ).toEqual([]);
});
it('rejects empty scope, malformed captures, and mixed batch failures without losing valid changes', () => {
  const db = database();
  expect(() =>
    validateCall('saul_annotations', {
      ...request({ action: 'create', capture }),
      scope: { urls: [], ids: [] },
    }),
  ).toThrow();
  expect(() =>
    annotationStore(
      db,
      'p',
      request({ action: 'create', capture: { ...capture, url: 'file:///secret' } }),
    ),
  ).toThrow();
  annotationStore(db, 'p', request({ action: 'create', capture }));
  const result = annotationStore(
    db,
    'p',
    request({
      action: 'change',
      changes: [
        { id: capture.id, revision: 1, operationId: 'done', action: 'complete' },
        { id: 'missing', revision: 1, operationId: 'missing', action: 'delete' },
      ],
    }),
  );
  expect(result.outcomes![0]!.record!.state).toBe('done');
  expect(result.outcomes![1]!.error).toMatch(/unavailable/);
});
it('sends separately labeled images through Responses and rejects invalid image payloads', () => {
  const p = {
    action: 'generate' as const,
    accountId: 'account',
    model: 'gpt-6',
    systemPrompt: 'System',
    userPrompt: 'Evidence',
    images: [capture.image!],
  };
  validatePlanRequest(p);
  expect(responsesBody(p).input[0]!.content).toEqual([
    { type: 'input_text', text: 'Evidence' },
    { type: 'input_image', image_url: capture.image, detail: 'auto' },
  ]);
  expect(() => validatePlanRequest({ ...p, images: ['https://evil.test/image'] })).toThrow();
});
it('requires an explicit new reply after a terminal write fails and preserves a committed reply on lost acknowledgement', async () => {
  const sql = database();
  annotationStore(sql, 'p', request({ action: 'create', capture }));
  let rejectCompletion = true;
  let calls = 0;
  const db: DbCall = async (requestMessage) => {
    const message = requestMessage as DbRequest;
    if (message.type === 'DB_ANNOTATION')
      return annotationStore(sql, 'p', message.payload) as never;
    if (message.type === 'DB_ANNOTATION_ATTEMPT') {
      if (message.payload.action === 'complete' && rejectCompletion)
        throw new Error('Result storage unavailable');
      const result = annotationAttempts(sql, 'p', message.payload);
      if (message.payload.action === 'complete') throw new Error('Lost acknowledgement');
      return result as never;
    }
    throw new Error('Unexpected operation');
  };
  const runner = new AnnotationRunner(db, async function* () {
    calls++;
    yield { type: 'delta', text: 'Reviewed reply' };
    yield { type: 'complete' };
  });
  const input = {
    provider: 'openai-compatible',
    remote: { model: 'gpt-6', baseUrl: 'http://fixture' },
    local: {},
    context: { selection: '', pageUrl: url, pageTitle: '' },
    systemPrompt: '',
    userPrompt: '',
  } as RunInput;
  const respond = () =>
    runner.request(
      { action: 'respond', url, ids: [capture.id], presetId: 'p', textOnly: false, current: false },
      { choices: input, credential: '' },
    );
  const replies = () =>
    annotationStore(sql, 'p', request({ action: 'read', id: capture.id, image: false })).record!
      .replies;
  const first = (await respond()).ids![0]!;
  await expect
    .poll(() => annotationAttempts(sql, 'p', { action: 'read', id: first })[0]?.status)
    .toBe('failed');
  expect(replies()).toEqual([]);
  expect(calls).toBe(1);
  rejectCompletion = false;
  const second = (await respond()).ids![0]!;
  expect(second).not.toBe(first);
  await expect
    .poll(() => annotationAttempts(sql, 'p', { action: 'read', id: second })[0]?.status)
    .toBe('completed');
  expect(replies()).toEqual([expect.objectContaining({ id: second, text: 'Reviewed reply' })]);
  expect(calls).toBe(2);
});

it('rolls back the admitted input batch when one selected revision changed before saving', async () => {
  const sql = database();
  annotationStore(sql, 'p', request({ action: 'create', capture }));
  const second = { ...capture, id: 'annotation-two' };
  annotationStore(sql, 'p', request({ action: 'create', capture: second }));
  let calls = 0;
  const db: DbCall = async (requestMessage) => {
    const message = requestMessage as DbRequest;
    if (message.type === 'DB_ANNOTATION')
      return annotationStore(sql, 'p', message.payload) as never;
    if (message.type === 'DB_ANNOTATION_ATTEMPT') {
      if (message.payload.action === 'admit')
        annotationStore(
          sql,
          'p',
          request({
            action: 'change',
            changes: [
              {
                id: second.id,
                revision: 1,
                operationId: 'edit-before-save',
                action: 'edit',
                text: 'Edited',
              },
            ],
          }),
        );
      return annotationAttempts(sql, 'p', message.payload) as never;
    }
    throw new Error('Unexpected operation');
  };
  const runner = new AnnotationRunner(db, async function* () {
    calls++;
    yield { type: 'complete' };
  });
  await expect(
    runner.request(
      {
        action: 'respond',
        url,
        ids: [capture.id, second.id],
        presetId: 'p',
        textOnly: true,
        current: false,
      },
      { choices: { remote: { model: 'gpt-6' } } as RunInput, credential: '' },
    ),
  ).rejects.toThrow('Annotation changed before its inputs were saved');
  expect(calls).toBe(0);
  expect(annotationAttempts(sql, 'p', { action: 'read' })).toEqual([]);
});

it('deletion settles saved queued attempts and rejects late replies', () => {
  const db = database();
  annotationStore(db, 'p', request({ action: 'create', capture }));
  const attempt = {
    id: 'in-flight',
    annotationId: capture.id,
    url,
    revision: 1,
    status: 'queued' as const,
    createdAt: Date.now(),
    input: { remote: { model: 'gpt-6' } } as RunInput,
    evidence: 'Saved',
    raw: '',
  };
  annotationAttempts(db, 'p', { action: 'admit', attempts: [attempt] });
  annotationStore(
    db,
    'p',
    request({
      action: 'change',
      changes: [{ id: capture.id, revision: 1, operationId: 'delete-active', action: 'delete' }],
    }),
  );
  expect(() => annotationAttempts(db, 'p', { action: 'recover' })).not.toThrow();
  expect(annotationAttempts(db, 'p', { action: 'read', id: 'in-flight' })[0]!.status).toBe(
    'cancelled',
  );
  expect(() =>
    annotationAttempts(db, 'p', {
      action: 'complete',
      attempt: { ...attempt, status: 'completed', raw: 'Late reply' },
      revision: 1,
    }),
  ).toThrow(/no longer available/);
});

it('shares the two-invocation limit across separately admitted annotation batches', async () => {
  const sql = database();
  const ids = ['one', 'two', 'three', 'cancel-queued'];
  for (const id of ids)
    annotationStore(sql, 'p', request({ action: 'create', capture: { ...capture, id } }));
  const db: DbCall = async (message) => {
    const m = message as DbRequest;
    if (m.type === 'DB_ANNOTATION') return annotationStore(sql, 'p', m.payload) as never;
    if (m.type === 'DB_ANNOTATION_ATTEMPT') return annotationAttempts(sql, 'p', m.payload) as never;
    throw new Error('Unexpected operation');
  };
  let active = 0,
    maximum = 0;
  const releases: (() => void)[] = [];
  const runner = new AnnotationRunner(db, async function* () {
    maximum = Math.max(maximum, ++active);
    await new Promise<void>((resolve) => releases.push(resolve));
    active--;
    yield { type: 'delta', text: 'Reply' };
    yield { type: 'complete' };
  });
  for (const id of ids)
    await runner.request(
      { action: 'respond', url, ids: [id], presetId: 'p', textOnly: true, current: false },
      { choices: { remote: { model: 'gpt-6' } } as RunInput, credential: '' },
    );
  await expect.poll(() => releases.length).toBe(2);
  expect(maximum).toBe(2);
  const queued = annotationAttempts(sql, 'p', {
    action: 'read',
    annotationId: 'cancel-queued',
  })[0]!;
  await runner.request({ action: 'stop', id: queued.id });
  await expect
    .poll(() => annotationAttempts(sql, 'p', { action: 'read', id: queued.id })[0]!.status)
    .toBe('cancelled');
  releases[0]!();
  await expect.poll(() => releases.length).toBe(3);
  releases[1]!();
  releases[2]!();
  await expect
    .poll(() =>
      annotationAttempts(sql, 'p', { action: 'read' }).every(
        (a) => a.status === (a.id === queued.id ? 'cancelled' : 'completed'),
      ),
    )
    .toBe(true);
  expect(maximum).toBe(2);
  expect(releases).toHaveLength(3);
});
