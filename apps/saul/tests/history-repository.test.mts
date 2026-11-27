import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { SharedHistory } from '../native/storage/history.mts';
import { decodeHistoryRequest, type HistoryRequest } from '../shared/protocol/history-protocol.mts';

it('dispatches annotation defaults without changing the fingerprint of old History receipts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'saul-history-defaults-'));
  const history = new SharedHistory(directory);
  const owner = randomUUID();
  const operationId = randomUUID();
  const id = 'annotation';
  const url = 'https://example.test/article';
  // This explicit wire fixture is in lexical key order, as hashed by the v5 writer.
  const command = {
    change: 'annotations.change',
    input: {
      author: { kind: 'user', name: 'Person' },
      operation: {
        action: 'create',
        capture: {
          id,
          target: {
            frame: 'top document',
            kind: 'element',
            label: 'Article',
            rect: { height: 100, width: 100, x: 0, y: 0 },
            viewport: { height: 100, scale: 1, scrollX: 0, scrollY: 0, width: 100 },
          },
          title: 'Article',
          url,
        },
      },
      scope: { urls: [url] },
    },
    kind: 'commit',
  } as const;
  try {
    const request = { operation: 'history', owner, operationId, command };
    const feature = decodeHistoryRequest(request).feature?.message;
    expect(feature).toMatchObject({
      payload: { scope: { ids: [] }, operation: { capture: { comment: '' } } },
    });
    const reply = await history.run(request);
    expect(reply).toMatchObject({ revision: 1, value: { records: [{ id, comment: '' }] } });
    const oldFingerprint = createHash('sha256')
      .update(JSON.stringify(['saul', owner, command]))
      .digest('hex');
    expect(
      history.connection.selectValue(
        'SELECT fingerprint FROM history_receipt WHERE operation_id=?',
        [operationId],
      ),
    ).toBe(oldFingerprint);

    const oldId = randomUUID();
    history.connection.exec({
      sql: 'INSERT INTO history_receipt VALUES(?,?,?)',
      bind: [oldId, oldFingerprint, JSON.stringify(reply)],
    });
    history.connection.exec({
      sql: 'INSERT INTO history_receipt_record VALUES(?,?,?,?)',
      bind: [oldId, 'annotations', id, owner],
    });
    await expect(history.run({ ...request, operationId: oldId })).resolves.toEqual(reply);
    const explicitDefault = {
      ...command,
      input: { ...command.input, scope: { urls: [url], ids: [] } },
    };
    await expect(
      history.run({ ...request, operationId: oldId, command: explicitDefault }),
    ).rejects.toThrow('different History input');

    await history.run({
      ...request,
      operationId: randomUUID(),
      command: { kind: 'mask', target: { collection: 'annotations', id } },
    });
    await expect(history.run({ ...request, operationId: oldId })).rejects.toThrow(
      'saved content is unavailable',
    );
  } finally {
    history.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('scopes cursors, masks bytes, guards stale revisions and expires retained records', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'saul-history-repository-'));
  const history = new SharedHistory(directory);
  const owner = randomUUID();
  const targetID = randomUUID();
  const add = (id: string, timestamp: number, status = 'completed') => {
    history.connection.exec({
      sql: 'INSERT INTO ez_entry(id,created_at,data,image) VALUES(?,?,?,?)',
      bind: [
        id,
        timestamp,
        JSON.stringify({ query: 'query', response: 'response', model: 'test', status }),
        Buffer.from('image'),
      ],
    });
  };
  const send = (command: HistoryRequest['command'], operationId = randomUUID()) =>
    history.run({ operation: 'history', owner, operationId, command });
  const list = (visibility: 'visible' | 'masked' | 'all', cursor?: string) =>
    send({
      kind: 'list',
      view: 'library.records',
      query: { limit: 1, ...(cursor ? { cursor } : {}) },
      visibility,
    });
  const attachment = (visibility: 'visible' | 'masked' | 'all') =>
    send({
      kind: 'attachment',
      view: 'library.image',
      query: { selectionId: 'ez:' + targetID },
      visibility,
    });
  const target = { collection: 'library', id: 'ez:' + targetID } as const;
  try {
    add(targetID, 2);
    add(randomUUID(), 1);
    const first = (await list('visible')).value as {
      cursor: string;
      items: { selectionId: string }[];
    };
    expect(first.items[0]?.selectionId).toBe(target.id);
    expect(first.cursor).toBeTruthy();
    await expect(list('masked', first.cursor)).rejects.toThrow(/cursor/);
    add(randomUUID(), 3);
    const second = (await list('visible', first.cursor)).value as typeof first;
    expect(second.items[0]?.selectionId).not.toBe(target.id);
    expect(second.cursor).toBeUndefined();

    await expect(send({ kind: 'mask', target, expectedRevision: 0 })).rejects.toThrow(/changed/);
    const identity = randomUUID();
    const mask = { kind: 'mask', target, expectedRevision: 1 } as const;
    expect(await send(mask, identity)).toMatchObject({ revision: 2, value: null });
    expect(await send(mask, identity)).toMatchObject({ revision: 2, value: null });
    await expect(send({ kind: 'restore', target }, identity)).rejects.toThrow(/different/);
    expect((await attachment('visible')).value).toBeNull();
    expect((await attachment('masked')).value).toMatchObject({ data: 'aW1hZ2U=' });
    expect((await list('all')).value).toBeDefined();

    history.connection.exec({
      sql: "UPDATE history_record SET masked_at=? WHERE collection='library-native' AND id=?",
      bind: [Date.now() - 365 * 24 * 60 * 60 * 1000 - 1, targetID],
    });
    await expect(send({ kind: 'restore', target })).rejects.toThrow(/unavailable/);
    expect((await attachment('all')).value).toBeNull();
    expect(() => add(targetID, 2)).toThrow(/permanently deleted/);
    expect(await send(mask, identity)).toMatchObject({ revision: 2, value: null });
  } finally {
    history.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('commits generated annotation replies once in posting order and pages masked activity', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'saul-history-posting-'));
  const history = new SharedHistory(directory);
  const owner = randomUUID();
  const id = 'annotation';
  const url = 'https://example.test/article';
  const scope = { ids: [id], urls: [url] };
  const author = { kind: 'user', name: 'Person' };
  const commit = (change: string, input: unknown) =>
    history.run({
      operation: 'history',
      owner,
      operationId: randomUUID(),
      command: { kind: 'commit', change, input },
    });
  const read = (
    view: string,
    query: unknown,
    visibility: 'visible' | 'masked' | 'all' = 'visible',
  ) =>
    history.run({
      operation: 'history',
      owner,
      operationId: randomUUID(),
      command: { kind: 'entries', view, query, visibility },
    });
  try {
    await commit('annotations.change', {
      scope,
      author,
      operation: {
        action: 'create',
        capture: {
          id,
          url,
          title: 'Article',
          comment: 'Explain',
          target: {
            kind: 'element',
            label: 'Article',
            selector: 'article',
            frame: 'top document',
            rect: { x: 0, y: 0, width: 100, height: 100 },
            viewport: { width: 100, height: 100, scrollX: 0, scrollY: 0, scale: 1 },
          },
        },
      },
    });
    const generated = {
      id: 'generated',
      annotationId: id,
      url,
      createdAt: 1,
      status: 'queued',
      revision: 1,
      input: {
        provider: 'chrome-ai',
        remote: { baseUrl: '', model: '', temperature: 0 },
        systemPrompt: '',
        userPrompt: 'Reply',
      },
      evidence: 'Article',
      raw: '',
    };
    const failed = { ...generated, id: 'failed', createdAt: 2 };
    await expect(
      commit('annotations.attempt', {
        action: 'admit',
        attempts: [
          {
            ...generated,
            calls: [{ instructions: 'Read', input: '', raw: '', complete: false, extra: true }],
          },
        ],
      }),
    ).rejects.toThrow('command.input.attempts[0].calls[0].extra: unknown field');
    expect(history.connection.selectValue('SELECT count(*) FROM browser_annotation_attempt')).toBe(
      0,
    );
    await commit('annotations.attempt', { action: 'admit', attempts: [generated, failed] });
    await commit('annotations.attempt', {
      action: 'save',
      attempt: { ...generated, status: 'running' },
    });
    await commit('annotations.attempt', {
      action: 'save',
      attempt: { ...failed, status: 'failed', error: 'Failed once' },
    });
    await commit('annotations.change', {
      scope,
      author,
      operation: {
        action: 'change',
        changes: [{ id, revision: 1, action: 'append', operationId: 'human', text: 'Human first' }],
      },
    });
    await commit('annotations.attempt', {
      action: 'complete',
      attempt: { ...generated, status: 'completed', raw: 'Generated second' },
      revision: 2,
    });

    const first = (await read('annotations.conversation', { id, scope, limit: 1 })).value as {
      cursor: string;
      items: unknown[];
    };
    expect(first.items).toMatchObject([{ id: 'human', text: 'Human first' }]);
    const next = (await read('annotations.conversation', { id, scope, cursor: first.cursor }))
      .value;
    expect(next).toMatchObject({ items: [{ id: 'generated', text: 'Generated second' }] });
    const activity = (await read('annotations.activity', { annotationId: id })).value;
    expect(activity).toMatchObject({
      items: [
        { id: 'generated', status: 'completed' },
        { id: 'failed', status: 'failed' },
      ],
    });
    expect(
      history.connection.selectValue(
        "SELECT count(*) FROM history_entry WHERE collection='annotations' AND id='generated'",
      ),
    ).toBe(1);
    expect(
      String(history.connection.selectValue('SELECT body FROM browser_annotation')),
    ).not.toContain('Generated second');

    await history.run({
      operation: 'history',
      owner,
      operationId: randomUUID(),
      command: { kind: 'mask', target: { collection: 'annotations', id, entryId: 'generated' } },
    });
    expect((await read('annotations.conversation', { id, scope })).value).toMatchObject({
      items: [{ id: 'human' }],
    });
    expect((await read('annotations.activity', { annotationId: id }, 'all')).value).toMatchObject({
      items: [{ id: 'generated', maskedAt: expect.any(Number) }, { id: 'failed' }],
    });
    const revision = Number(
      history.connection.selectValue(
        "SELECT json_extract(body,'$.revision') FROM browser_annotation WHERE owner=? AND id=?",
        [owner, id],
      ),
    );
    const purgeBatch = {
      operation: 'history',
      owner,
      operationId: randomUUID(),
      command: {
        kind: 'commit',
        change: 'annotations.change',
        input: {
          scope,
          author,
          operation: {
            action: 'change',
            changes: [
              { id, revision, action: 'delete', operationId: randomUUID() },
              { id, revision: revision + 1, action: 'purge', operationId: randomUUID() },
            ],
          },
        },
      },
    };
    const acknowledged = await history.run(purgeBatch);
    expect(acknowledged.value).toEqual({ outcomes: [{ id }, { id }] });
    expect(await history.run(purgeBatch)).toEqual(acknowledged);
    expect(
      history.connection.selectValue(
        "SELECT count(*) FROM history_receipt WHERE acknowledgement LIKE '%Human first%' OR acknowledgement LIKE '%Explain%'",
      ),
    ).toBe(0);
  } finally {
    history.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('protects saving Call items and scopes masks, reuse, receipts and permanent clear', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'saul-history-calls-'));
  const history = new SharedHistory(directory);
  const owner = randomUUID();
  const id = 'batch';
  const url = 'https://example.test/article';
  const target = { collection: 'calls', id } as const;
  const item = { index: 0, tabId: 1, title: 'Article', url, status: 'saving', raw: 'Call output' };
  const source = { capturedAt: 1, truncated: false, coverage: 'all', text: 'Frozen article' };
  const send = (command: HistoryRequest['command'], operationId = randomUUID()) =>
    history.run({ operation: 'history', owner, operationId, command });
  const create = {
    kind: 'commit',
    change: 'calls.create',
    input: {
      id,
      windowId: 1,
      windowTitle: 'Window',
      createdAt: 1,
      prompt: 'Summarize',
      items: [item],
    },
  } as const;
  const lookup = () => send({ kind: 'list', view: 'calls.reusable', query: { urls: [url] } });
  try {
    const identity = randomUUID();
    await send(create, identity);
    expect((await lookup()).value).toBeNull();
    await expect(send({ kind: 'mask', target })).rejects.toThrow(/active Call/);
    await send({
      kind: 'commit',
      change: 'calls.update-item',
      input: { id, item: { ...item, status: 'completed' }, source },
    });
    history.connection.exec({
      sql: "UPDATE digest_item SET data=json_set(data,'$.futureInput',json('{\"version\":2}')) WHERE batch_id=?",
      bind: [id],
    });
    await expect(
      send({
        kind: 'commit',
        change: 'calls.update-item',
        input: { id, item: { ...item, status: 'completed' } },
      }),
    ).rejects.toThrow(/newer writer/);
    expect(
      history.connection.selectValue(
        "SELECT json_extract(data,'$.futureInput.version') FROM digest_item WHERE batch_id=?",
        [id],
      ),
    ).toBe(2);
    history.connection.exec({
      sql: "UPDATE digest_item SET data=json_remove(data,'$.futureInput') WHERE batch_id=?",
      bind: [id],
    });
    expect((await lookup()).value).toMatchObject({ id });
    await send({ kind: 'clear', collection: 'library' });
    expect((await lookup()).value).toMatchObject({ id });
    const entry = { ...target, entryId: '0' };
    await send({ kind: 'mask', target: entry });
    expect((await lookup()).value).toBeNull();
    expect(
      (await send({ kind: 'attachment', view: 'calls.source', query: { id, index: 0 } })).value,
    ).toBeNull();
    expect(
      (
        await send({
          kind: 'attachment',
          view: 'calls.source',
          query: { id, index: 0 },
          visibility: 'masked',
        })
      ).value,
    ).toMatchObject(source);
    expect(
      (await send({ kind: 'entries', view: 'calls.items', query: { id }, visibility: 'all' }))
        .value,
    ).toMatchObject({ items: [{ maskedAt: expect.any(Number) }] });
    await expect(send(create, identity)).rejects.toThrow(/unavailable/);
    await send({ kind: 'restore', target: entry });
    expect((await lookup()).value).toMatchObject({ id });
    await send({ kind: 'clear', collection: 'calls' });
    expect((await lookup()).value).toBeNull();
    expect(
      String(
        history.connection.selectValue(
          'SELECT acknowledgement FROM history_receipt WHERE operation_id=?',
          [identity],
        ),
      ),
    ).not.toContain('Call output');
    await expect(send(create, identity)).rejects.toThrow(/unavailable/);
  } finally {
    history.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('restoring a native parent respects its child mask, and purging the child erases both attachments', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'saul-history-native-child-'));
  const history = new SharedHistory(directory);
  const owner = randomUUID();
  const id = randomUUID();
  const parent = { collection: 'library', id: 'ez:' + id } as const;
  const child = { ...parent, entryId: id };
  const send = (command: HistoryRequest['command']) =>
    history.run({ operation: 'history', owner, operationId: randomUUID(), command });
  const image = (visibility: 'visible' | 'masked' | 'all') =>
    send({
      kind: 'attachment',
      view: 'library.image',
      query: { selectionId: parent.id },
      visibility,
    });
  const attempts = (visibility: 'visible' | 'masked' | 'all') =>
    send({
      kind: 'entries',
      view: 'reading.attempts',
      query: { selectionId: parent.id },
      visibility,
    });
  const saved = JSON.stringify({
    query: 'Private prompt',
    response: 'Private answer',
    model: 'test',
    status: 'completed',
  });
  try {
    history.connection.exec({
      sql: 'INSERT INTO ez_entry(id,created_at,data,image,input_image) VALUES(?,?,?,?,?)',
      bind: [id, 1, saved, Buffer.from('output'), Buffer.from('input')],
    });
    await send({ kind: 'mask', target: parent });
    await send({ kind: 'mask', target: child });
    await send({ kind: 'restore', target: parent });
    expect((await image('visible')).value).toBeNull();
    expect((await attempts('visible')).value).toEqual({ items: [] });
    expect((await image('masked')).value).toMatchObject({ data: 'b3V0cHV0' });
    expect((await attempts('all')).value).toMatchObject({
      items: [{ maskedAt: expect.any(Number) }],
    });
    await send({ kind: 'purge', target: child });
    expect((await image('all')).value).toBeNull();
    expect((await attempts('all')).value).toEqual({ items: [] });
    await expect(send({ kind: 'restore', target: child })).rejects.toThrow(/unavailable/);
    expect(
      history.connection.selectObject('SELECT data,image,input_image FROM ez_entry WHERE id=?', [
        id,
      ]),
    ).toMatchObject({
      data: '{}',
      image: null,
      input_image: null,
    });
    expect(
      history.connection.selectValue(
        "SELECT id FROM history_record WHERE collection='library-native' AND id=?",
        [id],
      ),
    ).toBe(id);
    expect(() =>
      history.connection.exec({
        sql: 'UPDATE ez_entry SET data=? WHERE id=?',
        bind: [saved, id],
      }),
    ).toThrow(/Restore/);
  } finally {
    history.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
