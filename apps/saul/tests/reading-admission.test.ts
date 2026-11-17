import { expect, it, vi } from 'vitest';
import { DEFAULT_CONFIGURATION } from '../src/configuration/definition';
import type { ReadingRequest } from '../src/reading/contract';
import { createReadingAdmission } from '../src/reading/admission';
import type { DbCall } from '../shared/protocol/history-types.ts';

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
