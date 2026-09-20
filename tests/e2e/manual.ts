import { createFixtureServer, createSandbox, taggedAnswer } from './support.ts';

// Uses Node's native TypeScript support (Node >=22.18); no extra runner needed.
const smoke = process.argv.includes('--smoke');
let sandbox: Awaited<ReturnType<typeof createSandbox>> | undefined;
let server: Awaited<ReturnType<typeof createFixtureServer>> | undefined;
let stop!: () => void;
const stopped = new Promise<void>((resolve) => {
  stop = resolve;
});
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
  server = await createFixtureServer(taggedAnswer);
  sandbox = await createSandbox({ headless: smoke });
  const { context, popup } = await sandbox.launch();
  context.once('close', stop);
  await popup.evaluate(async (origin) => {
    await chrome.storage.local.set({
      saul_user_settings: {
        activeProvider: 'openai-compatible',
        openaiCompatible: { baseUrl: `${origin}/v1`, apiKey: '', model: 'test-model' },
      },
    });
  }, server.origin);
  await popup.reload();
  const article = await context.newPage();
  await article.goto(`${server.origin}/article`);
  console.log(
    `Saul user-test sandbox\nArticle: ${article.url()}\nPopup: ${popup.url()}\nProfile: ${sandbox.profile}\nMock provider only. Close the browser or press Ctrl+C to clean up.`,
  );
  if (smoke) {
    await article.locator('saul-root').waitFor({ state: 'attached' });
    await article.locator('#concept').click({ clickCount: 3 });
    await article.getByRole('button', { name: 'Explain', exact: true }).click();
    await article.getByRole('button', { name: 'View', exact: true }).click();
    await article.getByRole('button', { name: 'Regenerate', exact: true }).waitFor();
    await popup.getByRole('button', { name: 'Reading history', exact: true }).click();
    await popup.getByText('"Gradient descent"', { exact: true }).waitFor();
    console.log('Sandbox smoke passed: selected, explained, and saved.');
  } else {
    await stopped;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  try {
    await sandbox?.close();
  } finally {
    await server?.close();
  }
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
}
