import { defineConfig } from '@playwright/test';

export default defineConfig({
  globalSetup: './tests/e2e/browser-preflight.ts',
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
});
