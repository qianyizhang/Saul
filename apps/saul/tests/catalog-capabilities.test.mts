import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { readLocalCatalog } from '../src/providers/local-catalog';

afterEach(() => vi.unstubAllGlobals());

const fixtures = JSON.parse(
  readFileSync(
    new URL('../../../contracts/fixtures/api-model-capabilities.json', import.meta.url),
    'utf8',
  ),
) as { endpoint: string; model: string; capabilities: string[] }[];

it.each(fixtures)(
  'classifies $model from $endpoint like the signed owner',
  async ({ endpoint, model, capabilities }) => {
    const fetch = vi.fn(async () => Response.json({ data: [{ id: model }] }));
    vi.stubGlobal('fetch', fetch);
    const { catalog } = await readLocalCatalog(
      { baseUrl: endpoint, apiKey: 'fixture' },
      new AbortController().signal,
    );
    expect(fetch).toHaveBeenCalledWith(
      endpoint + '/models',
      expect.objectContaining({ redirect: 'error' }),
    );
    expect(catalog.models).toEqual([
      { id: model, name: model, capabilities, efforts: [], defaultEffort: '' },
    ]);
  },
);
