import { defineConfig } from '@playwright/test';
import base from '../../playwright.config.ts';
import { artifactConfig } from './artifacts.ts';

export default defineConfig({
  ...base,
  ...artifactConfig('benchmark'),
  globalSetup: './browser-preflight.ts',
  testDir: '.',
  testMatch: '**/*.benchmark.ts',
});
