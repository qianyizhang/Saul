import { afterEach, expect, it, vi } from 'vitest';
import { streamModel } from '../src/models/provider';
import { DEFAULT_SETTINGS } from '../src/storage/settings';
import { chromeAiAvailability, prepareChromeAi, streamChromeAi } from '../src/models/chrome-ai';
afterEach(() => vi.unstubAllGlobals());
it('blocks saved or queued on-device requests at the provider boundary while disabled', async () => {
  const create = vi.fn();
  vi.stubGlobal('LanguageModel', { availability: async () => 'available', create });
  await expect(
    streamModel(
      {
        provider: 'chrome-ai',
        remote: DEFAULT_SETTINGS.openaiCompatible,
        local: DEFAULT_SETTINGS.chromeAi,
        systemPrompt: 'system',
        userPrompt: 'question',
        context: { selection: 'term', pageTitle: '', pageUrl: '' },
      },
      '',
    ).next(),
  ).rejects.toThrow('temporarily disabled');
  expect(create).not.toHaveBeenCalled();
});
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
it('distinguishes an absent API, browser unavailability, and a failed availability check', async () => {
  vi.stubGlobal('LanguageModel', undefined);
  expect(await chromeAiAvailability()).toBe('unsupported');
  await expect(prepareChromeAi()).rejects.toThrow('does not expose');
  const create = vi.fn();
  vi.stubGlobal('LanguageModel', { availability: async () => 'unavailable', create });
  expect(await chromeAiAvailability()).toBe('unavailable');
  await expect(streamChromeAi({}, 'system', 'question').next()).rejects.toThrow(
    'chrome://on-device-internals',
  );
  expect(create).not.toHaveBeenCalled();
  vi.stubGlobal('LanguageModel', {
    availability: async () => {
      throw new Error('Policy check failed');
    },
  });
  await expect(chromeAiAvailability()).rejects.toThrow('Policy check failed');
});
it('verifies preparation readiness and releases a created session even when readiness is unavailable', async () => {
  const destroy = vi.fn();
  const availability = vi.fn().mockResolvedValue('unavailable');
  vi.stubGlobal('LanguageModel', { availability, create: async () => ({ destroy }) });
  await expect(prepareChromeAi()).rejects.toThrow('not ready');
  expect(destroy).toHaveBeenCalledOnce();
  availability.mockResolvedValue('available');
  await expect(prepareChromeAi()).resolves.toBe('available');
});
it('checks availability with the requested output language and releases sessions on stream failure', async () => {
  const destroy = vi.fn();
  const availability = vi.fn().mockResolvedValue('available');
  const create = vi.fn(async () => ({
    destroy,
    async *promptStreaming() {
      yield 'partial';
      throw new Error('Local model failed');
    },
  }));
  vi.stubGlobal('LanguageModel', { availability, create });
  const stream = streamChromeAi({ outputLanguage: 'ja' }, 'system', 'question');
  expect((await stream.next()).value).toEqual({ type: 'delta', text: 'partial' });
  await expect(stream.next()).rejects.toThrow('Local model failed');
  const output = { expectedOutputs: [{ type: 'text', languages: ['ja'] }] };
  expect(availability).toHaveBeenCalledWith(output);
  expect(create).toHaveBeenCalledWith(expect.objectContaining(output));
  expect(destroy).toHaveBeenCalledOnce();
});
it('releases a cancelled session without reporting completion', async () => {
  const controller = new AbortController(),
    destroy = vi.fn();
  vi.stubGlobal('LanguageModel', {
    availability: async () => 'available',
    create: async () => ({
      destroy,
      async *promptStreaming() {
        yield 'partial';
        controller.abort();
        yield 'late';
      },
    }),
  });
  const events = [];
  for await (const event of streamChromeAi({}, 'system', 'question', controller.signal))
    events.push(event);
  expect(events).toEqual([{ type: 'delta', text: 'partial' }]);
  expect(destroy).toHaveBeenCalledOnce();
});
