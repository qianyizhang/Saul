import { defineConfig } from '@playwright/test';
import { artifactConfig } from './tests/e2e/artifacts.ts';

export default defineConfig({
  ...artifactConfig('e2e'),
  globalSetup: './tests/e2e/browser-preflight.ts',
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
});
