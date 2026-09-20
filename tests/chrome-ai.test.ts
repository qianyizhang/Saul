import { afterEach, expect, it, vi } from 'vitest';
import { chromeAiAvailability, streamChromeAi } from '../src/models/chrome-ai';
afterEach(() => vi.unstubAllGlobals());
it('keeps every modern delta and releases the session', async () => {
  const destroy = vi.fn();
  const create = vi.fn(async () => ({
    destroy,
    async *promptStreaming() {
      yield 'Hello';
      yield ' there';
    },
  }));
  vi.stubGlobal('LanguageModel', { availability: async () => 'available', create });
  const parts = [];
  for await (const part of streamChromeAi({}, 'system', 'question')) parts.push(part);
  expect(parts).toEqual([
    { type: 'delta', text: 'Hello' },
    { type: 'delta', text: ' there' },
    { type: 'complete' },
  ]);
  expect(destroy).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ initialPrompts: [{ role: 'system', content: 'system' }] }),
  );
});
it('reports a required download rather than treating it as ready', async () => {
  const create = vi.fn();
  vi.stubGlobal('LanguageModel', { availability: async () => 'downloadable', create });
  expect(await chromeAiAvailability()).toBe('downloadable');
  await expect(streamChromeAi({}, 'system', 'question').next()).rejects.toThrow('Prepare');
  expect(create).not.toHaveBeenCalled();
});
