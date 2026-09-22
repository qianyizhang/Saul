import { test, expect } from './fixtures.ts';

test('extension invalidation removes stale page UI without reconnect errors', async ({
  sandbox,
  fixtureServer,
}) => {
  const { context, worker } = await sandbox.launch();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${fixtureServer.origin}/article`);
  await expect(page.locator('saul-root')).toHaveCount(1);
  await page.locator('#concept').click({ clickCount: 3 });
  await expect(page.getByRole('button', { name: 'Explain', exact: true })).toBeVisible();

  // The worker may close before acknowledging its own reload request.
  await worker
    .evaluate(() => chrome.runtime.reload())
    .catch((error: Error) => {
      if (!/closed|destroyed/i.test(error.message)) throw error;
    });
  await expect(page.locator('saul-root')).toHaveCount(0);
  expect(errors).toEqual([]);
});
