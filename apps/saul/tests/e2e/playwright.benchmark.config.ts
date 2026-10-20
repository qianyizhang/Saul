import { defineConfig } from '@playwright/test';
import base from '../../playwright.config.ts';

export default defineConfig({
  ...base,
  globalSetup: './browser-preflight.ts',
  testDir: '.',
  testMatch: '**/*.benchmark.ts',
});
