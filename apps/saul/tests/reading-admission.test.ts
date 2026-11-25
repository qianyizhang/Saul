import { expect, it, vi } from 'vitest';
import { DEFAULT_CONFIGURATION } from '../src/configuration/definition';
import type { ReadingRequest } from '../src/reading/contract';
import { createReadingAdmission } from '../src/reading/admission';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SharedHistory } from '../native/storage/history.mts';
import { createHistoryRequest } from '../shared/protocol/history-protocol.mts';
import { ReadingRunner } from '../src/reading/runner';
import type { DbCall, DbType, DbRequest, DbOperations } from '../shared/protocol/history-types.ts';

const url = 'https://example.test/article';
const submit: ReadingRequest<'submit'> = {
  action: 'submit',
  submissionId: 'input',
  snapshot: {
    id: 'selection',
    text: 'The selected text',
    page: { url, title: 'Article' },
    anchor: { exact: 'The selected text', prefix: '', suffix: '' },
    viewport: { x: 1, y: 1, width: 10, height: 10, scrollX: 0, scrollY: 0 },
    capturedAt: 1,
  },
  context: { selection: 'Overridden by the admitted source', pageTitle: 'Article', pageUrl: url },
};

it('uses the same default action for reuse lookup and admission even if Settings change between them', async () => {
  const original = structuredClone(DEFAULT_CONFIGURATION);
  original.openaiCompatible.apiKey = 'fixture key';
  original.configuration!.presets[0]!.model = 'fixture-model';
  original.configuration!.selectedRecipeId = 'recipe-lookup';
  const later = structuredClone(original);
  later.configuration!.selectedRecipeId = 'recipe-explain';
  const readSettings = vi.fn(async () => later).mockResolvedValueOnce(original);
  const query = vi.fn(async () => undefined);
  const admission = createReadingAdmission(readSettings, query as unknown as DbCall);

  expect(await admission.submit(submit, url)).toMatchObject({
    kind: 'ready',
    submission: {
      input: { recipe: { id: 'recipe-lookup' }, context: { selection: 'The selected text' } },
    },
  });
  expect(query).toHaveBeenCalledWith({
    type: 'DB_READING_RESOLVE',
    payload: expect.objectContaining({ recipeId: 'recipe-lookup' }),
  });
  expect(readSettings).toHaveBeenCalledTimes(1);
});

it('reopens a known saved attempt when the current provider setup is unavailable', async () => {
  const readSettings = vi.fn(async () => {
    throw new Error('Settings unavailable');
  });
  const query = vi.fn(async () => 'saved-passage');
  const admission = createReadingAdmission(readSettings, query as unknown as DbCall);

  expect(await admission.submit({ ...submit, recipeId: 'recipe-lookup' }, url)).toEqual({
    kind: 'reused',
    passageId: 'saved-passage',
  });
  expect(readSettings).not.toHaveBeenCalled();
});

it.each([
  ['retry', 'entry-mask'],
  ['follow-up', 'parent-purge'],
] as const)(
  'rejects prepared %s after a concurrent %s without starting a provider',
  async (kind, deletion) => {
    const directory = mkdtempSync(join(tmpdir(), 'saul-durable-reading-source-'));
    const store = new SharedHistory(directory);
    const peer = new SharedHistory(directory);
    const owner = randomUUID();
    const peerOwner = randomUUID();
    const claims = vi.fn();
    const db: DbCall = async <K extends DbType>(message: DbRequest<K>) => {
      if (message.type === 'DB_CLAIM') claims();
      const envelope = await store.run(
        createHistoryRequest(owner, randomUUID(), message as DbRequest),
      );
      return (envelope.value ?? undefined) as DbOperations[K]['result'];
    };
    const settings = structuredClone(DEFAULT_CONFIGURATION);
    settings.openaiCompatible.apiKey = 'fixture key';
    settings.configuration!.presets[0]!.model = 'fixture-model';
    const admission = createReadingAdmission(async () => settings, db);
    try {
      const first = await admission.submit(submit, url);
      expect(first.kind).toBe('ready');
      if (first.kind !== 'ready') throw new Error('Expected a new attempt');
      const seeded = await db({ type: 'DB_SUBMIT', payload: first.submission });
      const runId = seeded.run!.id;
      await db({ type: 'DB_CLAIM', payload: { runId } });
      await db({ type: 'DB_SAVING', payload: { runId } });
      await db({
        type: 'DB_FINISH',
        payload: { runId, status: 'completed', raw: 'Saved source answer', latencyMs: 1 },
      });
      claims.mockClear();

      const passage = await db({ type: 'DB_PASSAGE', payload: { selectionId: seeded.passageId } });
      const request: ReadingRequest<'regenerate'> = {
        action: 'regenerate',
        selectionId: seeded.passageId,
        submissionId: 'derived-attempt',
        ...(kind === 'follow-up' ? { runId, instruction: 'Explain the second step' } : {}),
      };
      const derived = await admission.regenerate(request, passage!);
      if (derived.kind !== 'ready') throw new Error('Expected prepared saved input');
      expect(derived.submission.source).toEqual({
        selectionId: seeded.passageId,
        runId,
        revision: passage!.revision,
      });

      const target = {
        collection: 'library' as const,
        id: seeded.passageId,
        ...(deletion === 'entry-mask' ? { entryId: runId } : {}),
      };
      await peer.run({
        operation: 'history',
        owner: peerOwner,
        operationId: randomUUID(),
        command: { kind: deletion === 'entry-mask' ? 'mask' : 'purge', target },
      });
      const runner = new ReadingRunner(db, vi.fn());
      await expect(runner.submit(derived.submission, derived.credential)).rejects.toThrow(
        /saved source changed or was deleted/,
      );
      expect(claims).not.toHaveBeenCalled();
      expect(
        store.connection.selectValue('SELECT id FROM submission WHERE id=?', ['derived-attempt']),
      ).toBeUndefined();

      const fresh = await admission.submit({ ...submit, submissionId: 'fresh' }, url);
      if (fresh.kind !== 'ready') throw new Error('Expected fresh capture after deletion');
      expect(fresh.submission.source).toBeUndefined();
      expect(await db({ type: 'DB_SUBMIT', payload: fresh.submission })).toMatchObject({
        run: { id: expect.any(String) },
      });
    } finally {
      peer.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
