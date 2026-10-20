import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export function artifactConfig(suite: 'e2e' | 'benchmark') {
  const run = process.env.SAUL_TEST_RUN ?? 'latest';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(run)) {
    throw new Error('SAUL_TEST_RUN must contain only letters, digits, underscores or hyphens.');
  }
  const directory = new URL(`../../../../.artifacts/saul/${suite}/${run}/`, import.meta.url);
  return defineConfig({
    outputDir: fileURLToPath(new URL('results/', directory)),
    reporter: [
      ['list'],
      ['html', { open: 'never', outputFolder: fileURLToPath(new URL('report/', directory)) }],
    ],
  });
}
