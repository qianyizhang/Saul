import { beforeEach, expect, it, vi } from 'vitest';
import type { FullConfig } from '@playwright/test';
import browserPreflight from './e2e/browser-preflight.ts';
import { createSandbox } from './e2e/support.ts';

vi.mock('./e2e/support.ts', () => ({ createSandbox: vi.fn() }));
const launch = vi.fn();
const close = vi.fn();
const config = { projects: [{ outputDir: '/tmp/saul-preflight-test' }] } as FullConfig;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createSandbox).mockResolvedValue({ launch, close } as unknown as Awaited<
    ReturnType<typeof createSandbox>
  >);
});

it('propagates a startup failure without retrying and retains diagnostics during cleanup', async () => {
  const cause = new Error('simulated browser startup denial');
  launch.mockRejectedValue(cause);
  await expect(browserPreflight(config)).rejects.toMatchObject({
    message: expect.stringContaining('the suite did not run'),
    cause,
  });
  expect(launch).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledWith(true);
});

it('closes the successful probe and discards its diagnostics before tests begin', async () => {
  await browserPreflight(config);
  expect(launch).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledWith(false);
});
