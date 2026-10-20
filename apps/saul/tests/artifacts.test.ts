import { afterEach, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { artifactConfig } from './e2e/artifacts.ts';

afterEach(() => vi.unstubAllEnvs());

it('keeps suite results and reports in separate workspace artifact trees', () => {
  vi.stubEnv('SAUL_TEST_RUN', undefined);
  const root = fileURLToPath(new URL('../../../.artifacts/saul/', import.meta.url));
  for (const suite of ['e2e', 'benchmark'] as const) {
    const config = artifactConfig(suite);
    expect(config.outputDir).toBe(`${root}${suite}/latest/results/`);
    expect(config.reporter).toContainEqual([
      'html',
      { open: 'never', outputFolder: `${root}${suite}/latest/report/` },
    ]);
  }
});

it('isolates reports as well as results for named runs', () => {
  vi.stubEnv('SAUL_TEST_RUN', 'review-2');
  const first = artifactConfig('e2e');
  vi.stubEnv('SAUL_TEST_RUN', 'review-3');
  const second = artifactConfig('e2e');
  expect(first.outputDir).not.toEqual(second.outputDir);
  expect(first.reporter).not.toEqual(second.reporter);
});

it.each(['../outside', '.', '', '/tmp/output', 'nested/run'])(
  'rejects unsafe run name %j',
  (run) => {
    vi.stubEnv('SAUL_TEST_RUN', run);
    expect(() => artifactConfig('e2e')).toThrow('SAUL_TEST_RUN');
  },
);
