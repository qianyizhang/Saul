import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FullConfig } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import browserPreflight from './e2e/browser-preflight.ts';
import { createSandbox } from './e2e/support.ts';

vi.mock('./e2e/support.ts', () => ({ createSandbox: vi.fn() }));
const launch = vi.fn();
const close = vi.fn();
let outputDir = '';
let config: FullConfig;

beforeEach(async () => {
  vi.resetAllMocks();
  outputDir = await mkdtemp(path.join(tmpdir(), 'saul-preflight-test-'));
  config = { projects: [{ outputDir }] } as FullConfig;
  vi.mocked(createSandbox).mockImplementation(async ({ artifactsDir } = {}) => {
    if (artifactsDir) await mkdir(artifactsDir, { recursive: true });
    return { launch, close } as unknown as Awaited<ReturnType<typeof createSandbox>>;
  });
});
afterEach(async () => rm(outputDir, { recursive: true, force: true }));

it('propagates a startup failure without retrying and retains diagnostics during cleanup', async () => {
  const cause = new Error('simulated browser startup denial');
  launch.mockRejectedValue(cause);
  await expect(browserPreflight(config)).rejects.toMatchObject({
    message: expect.stringContaining('the suite did not run'),
    cause,
  });
  expect(launch).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledWith(true);
  await expect(
    readFile(path.join(outputDir, 'browser-preflight', 'startup-error.log'), 'utf8'),
  ).resolves.toContain('simulated browser startup denial');
});

it('closes the successful probe and discards its diagnostics before tests begin', async () => {
  await browserPreflight(config);
  expect(launch).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledWith(false);
});
