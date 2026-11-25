import { test, expect } from '@playwright/test';
import { createSandbox } from './support.ts';
test('bounded text maps reject partial captures and uncertain matches', async ({}, info) => {
  const sandbox = await createSandbox({
    databaseFixtures: true,
    artifactsDir: info.outputPath('browser'),
  });
  try {
    const { popup, worker } = await sandbox.launch();
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/database-fixture.html`);
    const report = await popup.evaluate(async () => {
      const fixture = await import(chrome.runtime.getURL('marker-fixture.js'));
      return fixture.checkAnchorBounds();
    });
    expect(report).toEqual({
      characters: 1_000_000,
      truncated: true,
      captureRejected: true,
      resolution: 'unresolved',
      singleCharacters: 1_000_000,
      singleNodeRejected: true,
      nodes: 30_000,
      nodesTruncated: true,
    });
  } finally {
    await sandbox.close(info.status !== info.expectedStatus);
  }
});
