import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { runDatabaseFixture } from './database-harness.ts';
import { createSandbox } from './support.ts';

interface MarkerMeasurement {
  attached: number;
}

test('record SQLite WASM OPFS scale', async ({}, info) => {
  test.setTimeout(300_000);
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
    for (const runs of [50_000, 100_000])
      report.cases.push(await runDatabaseFixture(popup, { action: 'scale', runs }));
    await mkdir('docs/benchmarks', { recursive: true });
    await writeFile('docs/benchmarks/reading-scale.json', JSON.stringify(report, null, 2) + '\n');
    expect(report.cases).toHaveLength(2);
  } finally {
    await sandbox.close(info.status !== info.expectedStatus);
  }
});

test('record populated-page annotation performance', async ({}, info) => {
  const sandbox = await createSandbox({
    databaseFixtures: true,
    artifactsDir: info.outputPath('browser'),
  });
  try {
    const { popup, context, worker } = await sandbox.launch();
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/database-fixture.html`);
    const cases = (await popup.evaluate(async () => {
      const fixture = await import(chrome.runtime.getURL('marker-fixture.js'));
      return [await fixture.measureMarkers(100), await fixture.measureMarkers(1000)];
    })) as MarkerMeasurement[];
    await mkdir('docs/benchmarks', { recursive: true });
    await writeFile(
      'docs/benchmarks/reading-rendering.json',
      JSON.stringify(
        { recordedAt: new Date().toISOString(), browser: context.browser()?.version(), cases },
        null,
        2,
      ) + '\n',
    );
    expect(cases.map((item) => item.attached)).toEqual([100, 1000]);
  } finally {
    await sandbox.close(info.status !== info.expectedStatus);
  }
});

test('record CSS Highlight support in target Chrome', async ({}, info) => {
  const sandbox = await createSandbox({ artifactsDir: info.outputPath('browser') });
  try {
    const { context } = await sandbox.launch();
    const page = await context.newPage();
    await page.setContent('<p id="concept">Gradient descent</p>');
    const capability = await page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector('#concept')!);
      const api = CSS as unknown as {
        highlights?: Map<string, unknown> & { highlightsFromPoint?: unknown };
      };
      const Highlight = (globalThis as unknown as { Highlight?: new (range: Range) => unknown })
        .Highlight;
      if (!api.highlights || !Highlight) return { highlights: false };
      api.highlights.set('feasibility', new Highlight(range));
      const style = document.createElement('style');
      style.textContent =
        '::highlight(feasibility){text-decoration:underline;text-decoration-color:red;}';
      document.head.append(style);
      const decoration = getComputedStyle(
        document.querySelector('#concept')!,
        '::highlight(feasibility)',
      ).textDecorationLine;
      const hitTesting = typeof api.highlights.highlightsFromPoint === 'function';
      api.highlights.delete('feasibility');
      style.remove();
      return { highlights: true, decoration, hitTesting };
    });
    await mkdir('docs/benchmarks', { recursive: true });
    await writeFile(
      'docs/benchmarks/rendering-capabilities.json',
      JSON.stringify({ browser: context.browser()?.version(), ...capability }, null, 2) + '\n',
    );
    expect(capability.highlights).toBe(true);
  } finally {
    await sandbox.close(info.status !== info.expectedStatus);
  }
});
