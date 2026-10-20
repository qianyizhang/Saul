import { test as base } from '@playwright/test';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  createFixtureServer,
  createSandbox,
  type ExtensionSandbox,
  type FixtureServer,
} from './support.ts';

export { expect } from '@playwright/test';
export const test = base.extend<
  { sandbox: ExtensionSandbox; browserToolsFixtures: boolean; chromeAiFixtures: boolean },
  { fixtureServer: FixtureServer }
>({
  browserToolsFixtures: [false, { option: true }],
  chromeAiFixtures: [false, { option: true }],
  fixtureServer: [
    async ({}, use) => {
      const server = await createFixtureServer();
      try {
        await use(server);
      } finally {
        await server.close();
      }
    },
    { scope: 'worker' },
  ],
  sandbox: async ({ browserToolsFixtures, chromeAiFixtures }, use, info) => {
    const artifactsDir = info.outputPath('browser');
    const sandbox = await createSandbox({
      headless: !process.env.HEADED,
      artifactsDir,
      browserToolsFixtures,
      chromeAiFixtures,
    });
    try {
      await use(sandbox);
    } finally {
      const failed = info.status !== info.expectedStatus;
      await sandbox.close(failed);
      if (failed) {
        for (const name of await readdir(artifactsDir)) {
          await info.attach(name.endsWith('.zip') ? 'trace' : name, {
            path: path.join(artifactsDir, name),
            contentType: name.endsWith('.zip')
              ? 'application/zip'
              : name.endsWith('.png')
                ? 'image/png'
                : 'text/plain',
          });
        }
      }
    }
  },
});
