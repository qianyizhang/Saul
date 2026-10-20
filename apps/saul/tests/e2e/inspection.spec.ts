import { test, expect } from './fixtures.ts';
import { configureFixtureProvider, createFixtureServer, taggedAnswer } from './support.ts';
import { explainSelection, getFirstHistory, openFirstPageExplanation } from './driver.ts';

test('inspection matches the submitted request, retains literal output, and survives settings changes and restart', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const launched = await sandbox.launch();
  let popup = launched.popup;
  const context = launched.context;
  await configureFixtureProvider(popup, fixtureServer.origin);
  const initial = fixtureServer.requests.length;
  const article = await context.newPage();
  await article.goto(fixtureServer.origin + '/article');
  await explainSelection(article);
  await expect.poll(async () => (await getFirstHistory(popup)).latest.status).toBe('completed');
  const saved = await getFirstHistory(popup);
  const body = JSON.parse(fixtureServer.requests[initial]!.body) as {
    messages: { role: string; content: string }[];
  };
  expect(saved.latest.inspection!.systemPrompt).toBe(body.messages[0]!.content);
  expect(saved.latest.inspection!.userPrompt).toBe(body.messages[1]!.content);
  await openFirstPageExplanation(article);
  const inspector = article.locator('.saul-card > div > .saul-inspector');
  await inspector.locator(':scope > summary').click();
  expect(
    await inspector
      .getByRole('region', { name: 'Prompt · user', exact: true })
      .locator('pre')
      .textContent(),
  ).toBe(body.messages[1]!.content);
  expect(
    await inspector
      .getByRole('region', { name: 'Response · raw text', exact: true })
      .locator('pre')
      .textContent(),
  ).toBe(saved.responseRaw);
  await inspector.getByText('Context / inputs', { exact: true }).click();
  await expect(
    inspector.getByRole('region', { name: 'Selected text', exact: true }).locator('pre'),
  ).toHaveText('Gradient descent');

  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await popup.getByText('System instructions', { exact: true }).click();
  await popup
    .getByLabel('Recipe system instructions', { exact: true })
    .fill('Changed after generation');
  await popup.getByLabel('Prompt template', { exact: true }).fill('Changed {{text}}');
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(popup.getByText('Saved', { exact: true })).toBeVisible();
  ({ popup } = await sandbox.launch());
  const restored = await getFirstHistory(popup);
  expect(restored.latest.inspection).toEqual(saved.latest.inspection);
  await popup.locator('.history-title').click();
  const historyInspector = popup.locator('.answer > .saul-inspector');
  await historyInspector.locator(':scope > summary').click();
  expect(
    await historyInspector
      .getByRole('region', { name: 'Instructions', exact: true })
      .locator('pre')
      .textContent(),
  ).toBe(body.messages[0]!.content);
  // Exercise failure feedback in the extension page without touching the clipboard.
  await popup.evaluate(() =>
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async () => {
        throw new Error('denied');
      },
    }),
  );
  await historyInspector.getByRole('button', { name: 'Copy Prompt · user', exact: true }).click();
  await expect(historyInspector.getByRole('status')).toHaveText(
    'Could not copy. Select the text and copy it manually.',
  );
  for (const width of [360, 900]) {
    for (const colorScheme of ['light', 'dark'] as const) {
      await popup.setViewportSize({ width, height: 850 });
      await popup.emulateMedia({ colorScheme });
      await historyInspector
        .getByRole('region', { name: 'Prompt · user', exact: true })
        .scrollIntoViewIfNeeded();
      expect(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await popup.screenshot({ path: info.outputPath(`inspection-${width}-${colorScheme}.png`) });
    }
  }
  expect(fixtureServer.requests.length).toBe(initial + 1);
});

test('interrupted inspection preserves literal markup and identifies incomplete output', async ({
  sandbox,
}, info) => {
  const server = await createFixtureServer(taggedAnswer, { ending: 'eof' });
  try {
    const { popup, context } = await sandbox.launch();
    await configureFixtureProvider(popup, server.origin);
    const article = await context.newPage();
    await article.goto(server.origin + '/article');
    await explainSelection(article);
    await expect.poll(async () => (await getFirstHistory(popup)).latest.status).toBe('interrupted');
    await openFirstPageExplanation(article);
    const inspector = article.locator('.saul-card > div > .saul-inspector');
    await inspector.locator(':scope > summary').click();
    await expect(inspector).toContainText('interrupted');
    const response = inspector.getByRole('region', { name: 'Response · raw text', exact: true });
    expect(await response.locator('pre').textContent()).toBe(taggedAnswer);
    await expect(response.locator('term')).toHaveCount(0);
    await response.scrollIntoViewIfNeeded();
    await article.screenshot({ path: info.outputPath('interrupted-inspection.png') });
    expect(server.requests).toHaveLength(1);
  } finally {
    await server.close();
  }
});
