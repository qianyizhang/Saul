import { test, expect } from './fixtures.ts';
import { configureFixtureProvider, createFixtureServer } from './support.ts';
import { getFirstHistory, getHistory, openFirstPageExplanation, sendDb } from './driver.ts';
import type { Page } from '@playwright/test';
import type { UserSettings } from '../../src/types';

async function selectRecipe(page: Page, recipeId: string) {
  await page.locator('#concept').click({ clickCount: 3 });
  await expect(page.getByRole('combobox', { name: 'Recipe', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Recipe', exact: true }).selectOption(recipeId);
  await page.getByRole('button', { name: 'Explain', exact: true }).click();
}
function sentRequest(server: Awaited<ReturnType<typeof createFixtureServer>>, index: number) {
  return JSON.parse(server.requests[index]!.body) as {
    model: string;
    messages: { role: string; content: string }[];
  };
}

test('named presets and recipes save, choose their models, and create a new attempt on the same source', async ({
  sandbox,
  fixtureServer,
}, info) => {
  const { popup, context } = await sandbox.launch();
  const initialRequests = fixtureServer.requests.length;
  await configureFixtureProvider(popup, fixtureServer.origin);
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(popup.getByLabel('Preset name', { exact: true })).toHaveValue('Current');
  await popup.getByLabel('Preset name', { exact: true }).fill('Short');
  await popup.getByRole('button', { name: 'Add preset', exact: true }).click();
  await popup.getByLabel('Preset name', { exact: true }).fill('Careful');
  await popup.getByLabel('Model name', { exact: true }).fill('careful-model');
  const carefulId = await popup.getByLabel('Preset', { exact: true }).inputValue();
  await popup.getByLabel('Edit recipe', { exact: true }).selectOption('recipe-lookup');
  await popup.getByLabel('Default preset', { exact: true }).selectOption(carefulId);
  await popup
    .getByLabel('Prompt template', { exact: true })
    .fill('Look up {{text}}.\nUse this source:\n{{context}}');
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(popup.getByText('Saved', { exact: true })).toBeVisible();
  const article = await context.newPage();
  await article.goto(fixtureServer.origin + '/article');
  await selectRecipe(article, 'recipe-explain');
  await expect.poll(async () => (await getFirstHistory(popup)).latest.status).toBe('completed');
  const first = await getFirstHistory(popup);
  await selectRecipe(article, 'recipe-lookup');
  await expect
    .poll(async () => (await getFirstHistory(popup)).latest.recipe?.id)
    .toBe('recipe-lookup');
  await expect.poll(async () => (await getFirstHistory(popup)).latest.status).toBe('completed');
  expect(await getHistory(popup)).toHaveLength(1);
  expect(
    await sendDb(popup, { type: 'DB_RUNS', payload: { selectionId: first.selectionId } }),
  ).toHaveLength(2);
  expect(sentRequest(fixtureServer, initialRequests).model).toBe('test-model');
  expect(sentRequest(fixtureServer, initialRequests + 1).model).toBe('careful-model');
  const prompt = sentRequest(fixtureServer, initialRequests + 1).messages.find(
    (message) => message.role === 'user',
  )!.content;
  expect(prompt).toContain('Look up Gradient descent.');
  expect(prompt).not.toContain('Please explain this concept');
  expect(prompt.match(/Title: Calculus reading fixture/g)).toHaveLength(1);
  await popup.getByLabel('Default recipe', { exact: true }).selectOption('recipe-lookup');
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(popup.getByText('Saved', { exact: true })).toBeVisible();
  await popup.reload();
  await expect(popup.getByLabel('Default recipe', { exact: true })).toHaveValue('recipe-lookup');
  await expect(popup.getByLabel('Preset name', { exact: true })).toHaveValue('Careful');
  await article.reload();
  await article.locator('#second').click({ clickCount: 3 });
  await expect(article.getByLabel('Recipe', { exact: true })).toHaveValue('recipe-lookup');
  await article.keyboard.press('ControlOrMeta+Enter');
  await expect.poll(() => fixtureServer.requests.length).toBe(initialRequests + 3);
  expect(sentRequest(fixtureServer, initialRequests + 2).model).toBe('careful-model');

  for (const width of [360, 440]) {
    for (const scheme of ['light', 'dark'] as const) {
      await popup.setViewportSize({ width, height: 700 });
      await popup.emulateMedia({ colorScheme: scheme });
      await popup.getByLabel('Edit recipe', { exact: true }).selectOption('recipe-lookup');
      await popup.getByRole('region', { name: 'Recipes', exact: true }).scrollIntoViewIfNeeded();
      expect(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await popup.screenshot({ path: info.outputPath(`recipes-${width}-${scheme}.png`) });
      await popup.getByLabel('Preset', { exact: true }).scrollIntoViewIfNeeded();
      await popup.screenshot({ path: info.outputPath(`presets-${width}-${scheme}.png`) });
      await article.setViewportSize({ width, height: 700 });
      await article.emulateMedia({ colorScheme: scheme });
      const cdp = await context.newCDPSession(article);
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      await article.locator('#third').click({ clickCount: 3 });
      const choice = article.getByLabel('Recipe', { exact: true });
      await expect(choice.locator('option:checked')).toHaveText('Lookup · Careful');
      const box = (await choice.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await article.screenshot({ path: info.outputPath(`recipe-picker-${width}-${scheme}.png`) });
      await article.keyboard.press('Escape');
    }
  }
});

test('failed different-recipe attempts keep shown-answer metadata; Retry and follow-up use the correct frozen request', async ({
  sandbox,
}) => {
  const server = await createFixtureServer('A saved answer for the selected text.');
  try {
    const { popup, context } = await sandbox.launch();
    await configureFixtureProvider(popup, server.origin);
    const article = await context.newPage();
    await article.goto(server.origin + '/article');
    await selectRecipe(article, 'recipe-explain');
    await expect.poll(async () => (await getFirstHistory(popup)).latest.status).toBe('completed');
    const saved = await getFirstHistory(popup);
    await popup.getByRole('button', { name: 'Settings', exact: true }).click();
    await popup.getByLabel('Model name', { exact: true }).fill('model-b');
    await popup.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(popup.getByText('Saved', { exact: true })).toBeVisible();
    server.setEnding('eof');
    await selectRecipe(article, 'recipe-lookup');
    await expect.poll(async () => (await getFirstHistory(popup)).latest.status).toBe('interrupted');
    await openFirstPageExplanation(article);
    const card = article.getByRole('region', { name: 'Saul explanation' });
    await card.getByRole('button', { name: 'More', exact: true }).click();
    const detailSummary = card.locator(':scope > div > .saul-run-details > summary');
    await detailSummary.click();
    const details = detailSummary.locator('..');
    await expect(details).toContainText('Explain');
    await expect(details).toContainText('test-model');
    await expect(details).not.toContainText('model-b');
    await expect(card.getByRole('alert')).toBeVisible();
    expect((await getFirstHistory(popup)).completed?.id).toBe(saved.completed?.id);
    // Both the shown successful answer and the interrupted latest attempt retain their own prompts.
    const attempts = await sendDb(popup, {
      type: 'DB_RUNS',
      payload: { selectionId: saved.selectionId },
    });
    expect(attempts[0]!.inspection!.userPrompt).toBe(sentRequest(server, 1).messages[1]!.content);
    expect(attempts[1]!.inspection!.userPrompt).toBe(sentRequest(server, 0).messages[1]!.content);
    await popup.getByLabel('Model name', { exact: true }).fill('model-c');
    await popup.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(popup.getByText('Saved', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Retry explanation', exact: true }).click();
    await expect.poll(() => server.requests.length).toBe(3);
    await expect.poll(async () => (await getFirstHistory(popup)).latest.status).toBe('interrupted');
    expect(sentRequest(server, 2)).toEqual(sentRequest(server, 1));
    server.setEnding('done');
    await card.getByRole('button', { name: 'Simpler', exact: true }).click();
    await expect.poll(() => server.requests.length).toBe(4);
    await expect.poll(async () => (await getFirstHistory(popup)).latest.status).toBe('completed');
    const followup = sentRequest(server, 3);
    expect(followup.model).toBe('test-model');
    expect(followup.messages.find((message) => message.role === 'system')).toEqual(
      sentRequest(server, 0).messages.find((message) => message.role === 'system'),
    );
    expect(followup.messages.find((message) => message.role === 'user')!.content).toContain(
      'Follow-up request: Simpler',
    );
    expect((await getFirstHistory(popup)).latest.recipe?.id).toBe('recipe-explain');
  } finally {
    await server.close();
  }
});

test('missing recipe context or connection blocks submission without using another preset', async ({
  sandbox,
  fixtureServer,
}) => {
  const { popup, context } = await sandbox.launch();
  const initialRequests = fixtureServer.requests.length;
  await configureFixtureProvider(popup, fixtureServer.origin);
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await popup.getByLabel('Edit recipe', { exact: true }).selectOption('recipe-nudge');
  await popup.getByLabel('Prompt template', { exact: true }).fill('{{text}}\n{{heading}}');
  await popup.getByLabel('Section heading', { exact: true }).uncheck();
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(popup.getByText('Saved', { exact: true })).toBeVisible();
  const article = await context.newPage();
  await article.goto(fixtureServer.origin + '/article');
  await selectRecipe(article, 'recipe-nudge');
  await expect(article.getByRole('alert')).toContainText('needs {{heading}}');
  expect(fixtureServer.requests).toHaveLength(initialRequests);
  await popup.evaluate(async () => {
    const stored = await chrome.storage.local.get('saul_user_settings');
    const settings = stored.saul_user_settings as UserSettings;
    settings.configuration!.presets[0]!.profileId = 'removed-connection';
    await chrome.storage.local.set({ saul_user_settings: settings });
  });
  await selectRecipe(article, 'recipe-explain');
  await expect(article.getByRole('alert')).toContainText('saved connection');
  expect(fixtureServer.requests).toHaveLength(initialRequests);
});
