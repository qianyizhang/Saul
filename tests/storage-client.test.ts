import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ensureOffscreenDocument } from '../src/storage/client';

const hasDocument = vi.fn<() => Promise<boolean>>();
const createDocument = vi.fn<() => Promise<void>>();

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('chrome', {
    offscreen: { hasDocument, createDocument, Reason: { WORKERS: 'WORKERS' } },
  });
});
afterEach(() => vi.unstubAllGlobals());

it('holds concurrent callers until creation finishes even when Chrome reports existence early', async () => {
  const started = Promise.withResolvers<void>();
  const ready = Promise.withResolvers<void>();
  hasDocument.mockResolvedValueOnce(false).mockResolvedValue(true);
  createDocument.mockImplementation(() => {
    started.resolve();
    return ready.promise;
  });
  const first = ensureOffscreenDocument();
  await started.promise;
  let secondFinished = false;
  const second = ensureOffscreenDocument().then(() => {
    secondFinished = true;
  });
  await Promise.resolve();
  expect(secondFinished).toBe(false);
  ready.resolve();
  await Promise.all([first, second]);
  expect(createDocument).toHaveBeenCalledTimes(1);
});

it('retries creation after a failed attempt and reuses a document that already exists', async () => {
  hasDocument.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
  createDocument.mockRejectedValueOnce(new Error('creation denied')).mockResolvedValueOnce();
  await expect(ensureOffscreenDocument()).rejects.toThrow('creation denied');
  await ensureOffscreenDocument();
  await ensureOffscreenDocument();
  expect(createDocument).toHaveBeenCalledTimes(2);
});
