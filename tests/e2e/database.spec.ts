import { test, expect } from '@playwright/test';
import { createSandbox } from './support.ts';
import { readFile } from 'node:fs/promises';
import { runDatabaseFixture, type MigrationReport } from './database-harness.ts';
test('transactional legacy migration preserves responses/bookmarks, rolls back failure and rejects future schemas', async ({}, info) => {
  const sandbox = await createSandbox({
    databaseFixtures: true,
    artifactsDir: info.outputPath('browser'),
  });
  try {
    const { popup } = await sandbox.launch();
    const legacy = await readFile(
      new URL('../fixtures/legacy-schema.sql', import.meta.url),
      'utf8',
    );
    const report = await runDatabaseFixture<MigrationReport>(popup, { action: 'migrate', legacy });
    expect(report.rollback.failed).toBe(true);
    expect(report.rollback.version).toBe(0);
    expect(report.rollback.columns).not.toContain('viewed_at');
    expect(report.rollback.bookmark).toBe(1);
    expect(report.upgraded).toEqual({
      version: 1,
      response: 'A <term note="Slope">gradient</term>.',
      viewed: 4,
      bookmark: 1,
      search: 1,
    });
    expect(report.rejected).toBe(true);
  } finally {
    await sandbox.close(info.status !== info.expectedStatus);
  }
});

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
