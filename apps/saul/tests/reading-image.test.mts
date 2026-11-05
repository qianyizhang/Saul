import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { SaulDatabase } from '../src/storage/db';
import { ReadingRunner } from '../src/reading/runner';
import type { DbCall, DbRequest, Submission } from '../src/types/storage';
import { generateImage } from '../src/models/images';
import { HistoryConnection } from '../.build/native/history.mjs';
vi.mock('../src/models/images', async (original) => ({
  ...(await original<typeof import('../src/models/images')>()),
  generateImage: vi.fn(),
}));
const gif = readFileSync(
  new URL('../../../contracts/fixtures/animation.gif', import.meta.url),
).toString('base64');
function fixture() {
  const connection = new HistoryConnection(':memory:');
  connection.exec(readFileSync(new URL('../../../contracts/history.sql', import.meta.url), 'utf8'));
  const db = new SaulDatabase(connection);
  const submission: Submission = {
    submissionId: 'submit',
    regenerate: true,
    snapshot: {
      id: 'selection',
      text: 'tree',
      page: { url: 'https://example.test', title: 'Tree' },
      anchor: { exact: 'tree', prefix: '', suffix: '' },
      viewport: { x: 0, y: 0, width: 0, height: 0, scrollX: 0, scrollY: 0 },
      capturedAt: 1,
    },
    input: {
      provider: 'openai-compatible',
      remote: {
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-image-2.6-flare',
        temperature: 0.3,
      },
      local: { temperature: 0.3, topK: 3 },
      context: { selection: 'tree', pageTitle: 'Tree', pageUrl: 'https://example.test' },
      systemPrompt: '',
      userPrompt: 'tree',
      preset: {
        id: 'draw',
        name: 'Draw',
        provider: 'openai-compatible',
        model: 'gpt-image-2.6-flare',
        capability: 'draw',
        imageOptions: { size: '1024x1024', quality: 'low', outputFormat: 'gif' },
      },
    },
  };
  return { connection, db, submission };
}
afterEach(() => vi.clearAllMocks());
it('saves exact GIF bytes once, reopens each attempt, and deletes owned output', async () => {
  const { connection, db, submission } = fixture();
  try {
    const large = Buffer.concat([Buffer.from(gif, 'base64'), Buffer.alloc(1_000_000)]).toString(
      'base64',
    );
    vi.mocked(generateImage).mockResolvedValue({ data: large, mediaType: 'image/gif' });
    const runner = new ReadingRunner(
      (message) => db.execute(message),
      () => {},
    );
    await runner.submit(submission, 'fixture');
    await vi.waitFor(async () =>
      expect(
        (await db.execute({ type: 'DB_PASSAGE', payload: { selectionId: 'selection' } }))?.latest
          .status,
      ).toBe('completed'),
    );
    const history = await db.execute({ type: 'DB_GET_HISTORY', payload: {} });
    expect(history[0].hasImage).toBe(true);
    expect(history[0].latest.capability).toBe('draw');
    expect(
      await db.execute({
        type: 'DB_IMAGE',
        payload: { selectionId: 'selection', runId: history[0].latest.id },
      }),
    ).toEqual({ data: large, mediaType: 'image/gif' });
    expect(
      await db.execute({
        type: 'DB_IMAGE',
        payload: { selectionId: 'other', runId: history[0].latest.id },
      }),
    ).toBeUndefined();
    await runner.remove('selection');
    expect(
      await db.execute({ type: 'DB_IMAGE', payload: { selectionId: 'selection' } }),
    ).toBeUndefined();
    expect(generateImage).toHaveBeenCalledTimes(1);
  } finally {
    connection.close();
  }
});
it('image storage failure retains bytes for save-only recovery without another generation', async () => {
  const { connection, db, submission } = fixture();
  try {
    vi.mocked(generateImage).mockResolvedValue({ data: gif, mediaType: 'image/gif' });
    let fail = true;
    const call: DbCall = async (request) => {
      const message = request as DbRequest;
      if (message.type === 'DB_FINISH' && message.payload.status === 'completed' && fail) {
        fail = false;
        throw new Error('Disk failed');
      }
      return db.execute(message);
    };
    const runner = new ReadingRunner(call, () => {});
    await runner.submit(submission, 'fixture');
    const passage = await vi.waitFor(async () => {
      const p = runner.decorate(
        (await db.execute({ type: 'DB_PASSAGE', payload: { selectionId: 'selection' } }))!,
      );
      expect(p.latest.reason).toBe('save-failed');
      return p;
    });
    expect(runner.unsavedImage('selection', passage.latest.id)?.data).toBe(gif);
    await runner.saveImage('selection');
    expect(
      (await db.execute({ type: 'DB_PASSAGE', payload: { selectionId: 'selection' } }))?.latest
        .status,
    ).toBe('completed');
    expect(await db.execute({ type: 'DB_IMAGE', payload: { selectionId: 'selection' } })).toEqual({
      data: gif,
      mediaType: 'image/gif',
    });
    expect(generateImage).toHaveBeenCalledTimes(1);
  } finally {
    connection.close();
  }
});

it('a lost final-save acknowledgement reuses the committed image without a stuck recovery state', async () => {
  const { connection, db, submission } = fixture();
  try {
    vi.mocked(generateImage).mockResolvedValue({ data: gif, mediaType: 'image/gif' });
    let loseReply = true;
    const call: DbCall = async (request) => {
      const message = request as DbRequest;
      const value = await db.execute(request);
      if (message.type === 'DB_FINISH' && message.payload.status === 'completed' && loseReply) {
        loseReply = false;
        throw new Error('Reply lost after commit');
      }
      return value;
    };
    const runner = new ReadingRunner(call, () => {});
    await runner.submit(submission, 'fixture');
    const passage = await vi.waitFor(async () => {
      const value = await db.execute({ type: 'DB_PASSAGE', payload: { selectionId: 'selection' } });
      expect(value?.latest.status).toBe('completed');
      return runner.decorate(value!);
    });
    expect(passage.latest.reason).not.toBe('save-failed');
    expect(runner.unsavedImage('selection', passage.latest.id)).toBeUndefined();
    expect(await db.execute({ type: 'DB_IMAGE', payload: { selectionId: 'selection' } })).toEqual({
      data: gif,
      mediaType: 'image/gif',
    });
    expect(generateImage).toHaveBeenCalledTimes(1);
  } finally {
    connection.close();
  }
});
