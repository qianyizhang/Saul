import { expect, it, vi } from 'vitest';
import { streamModel } from '../src/models/provider';
import type { RunInput } from '../src/types/storage';

it('rejects a frozen retired-provider request without invoking a browser model or remote endpoint', async () => {
  const create = vi.fn();
  const fetch = vi.fn();
  vi.stubGlobal('LanguageModel', { create });
  vi.stubGlobal('fetch', fetch);
  const input: RunInput = {
    provider: 'chrome-ai',
    remote: { baseUrl: 'https://unused.test', model: 'unused', temperature: 0.3 },
    local: { temperature: 0.3, topK: 3 },
    context: { selection: 'saved', pageTitle: '', pageUrl: '' },
    systemPrompt: 'saved',
    userPrompt: 'saved',
  };
  try {
    await expect(streamModel(input, '').next()).rejects.toThrow('has been retired');
    expect(create).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
