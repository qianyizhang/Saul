import { accessSync, constants } from 'node:fs';
import { chromium } from '@playwright/test';

// The extension harness uses channel: 'chromium', which needs the full browser.
const executable = chromium.executablePath();
try {
  accessSync(executable, constants.X_OK);
  console.log(`Pinned Chromium is ready: ${executable}`);
} catch {
  console.error(`Pinned Chromium is missing or not executable: ${executable}`);
  console.error('Run pnpm test:e2e:install from apps/saul, using the same browser cache.');
  process.exitCode = 1;
}
