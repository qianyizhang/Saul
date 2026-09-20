import { test, expect } from '@playwright/test';
import { createSandbox } from './support.ts';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
const fixture = (page: Page, data: unknown) =>
  page.evaluate(async (data) => {
    const worker = new Worker(chrome.runtime.getURL('database-fixture.js'), { type: 'module' });
    try {
      return await new Promise<any>((resolve, reject) => {
        worker.onmessage = ({ data }) =>
          data.success ? resolve(data.result) : reject(new Error(data.error));
        worker.onerror = (e) => reject(new Error(e.message));
        worker.postMessage(data);
      });
    } finally {
      worker.terminate();
    }
  }, data);
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
    const report = await fixture(popup, { action: 'migrate', legacy });
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
test('SQLite WASM OPFS scale report', async ({}, info) => {
  test.skip(!process.env.SAUL_SCALE, 'Opt-in 10k passage / 50k and 100k run measurements');
  test.setTimeout(300000);
  const sandbox = await createSandbox({
    databaseFixtures: true,
    artifactsDir: info.outputPath('browser'),
  });
  try {
    const { popup, worker, context } = await sandbox.launch();
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/database-fixture.html`);
    await worker.evaluate(async () => {
      if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
    });
    const report = {
      recordedAt: new Date().toISOString(),
      browser: context.browser()?.version(),
      cases: [] as unknown[],
    };
    for (const runs of [50000, 100000])
      report.cases.push(await fixture(popup, { action: 'scale', runs }));
    await mkdir('docs/benchmarks', { recursive: true });
    await writeFile('docs/benchmarks/reading-scale.json', JSON.stringify(report, null, 2) + '\n');
    expect(report.cases).toHaveLength(2);
  } finally {
    await sandbox.close(info.status !== info.expectedStatus);
  }
});

test('populated-page annotation measurement', async ({}, info) => {
  test.skip(!process.env.SAUL_SCALE, 'Opt-in populated page rendering measurement');
  const sandbox = await createSandbox({
    databaseFixtures: true,
    artifactsDir: info.outputPath('browser'),
  });
  try {
    const { popup, context, worker } = await sandbox.launch();
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/database-fixture.html`);
    const cases = await popup.evaluate(async () => {
      const fixture = await import(chrome.runtime.getURL('marker-fixture.js'));
      return [await fixture.measureMarkers(100), await fixture.measureMarkers(1000)];
    });
    await mkdir('docs/benchmarks', { recursive: true });
    await writeFile(
      'docs/benchmarks/reading-rendering.json',
      JSON.stringify(
        { recordedAt: new Date().toISOString(), browser: context.browser()?.version(), cases },
        null,
        2,
      ) + '\n',
    );
    expect(cases.map((c) => c.attached)).toEqual([100, 1000]);
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
