import type { Page, Worker } from '@playwright/test';
import type { DbRequest } from '../../shared/protocol/history-types.ts';

export type DatabaseFixtureRequest =
  | { action: 'seed-native' }
  | { action: 'reset-migration' }
  | { action: 'migrate'; legacy: string }
  | { action: 'scale'; runs: number }
  | { action: 'db'; message: DbRequest }
  | { action: 'seed-history'; seed: HistorySeed };

export interface HistorySeed {
  origin: string;
  count: number;
  options: { prefix?: string; response?: string; title?: string };
}

interface FixtureReply {
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface MigrationReport {
  rollback: { failed: boolean; version: number; columns: string[]; bookmark: number };
  upgraded: { version: number; response: string; viewed: number; bookmark: number; search: number };
  upgradedV1: { version: number; response: string; tables: number };
  rejected: boolean;
}

export function runDatabaseFixture<T>(page: Page, request: DatabaseFixtureRequest): Promise<T> {
  return page.evaluate(async (request) => {
    const { saul_test_history_url: endpoint } =
      await chrome.storage.local.get('saul_test_history_url');
    const response = await fetch(endpoint + '/fixture', {
      method: 'POST',
      body: JSON.stringify(request),
    });
    const reply: FixtureReply = await response.json();
    if (!reply.success) throw new Error(reply.error);
    return reply.result as T;
  }, request);
}

// Prepare persisted rows through the isolated native SQLite fixture.
// Only fresh sandboxes with databaseFixtures enabled may use this helper.
export async function seedPersistedHistory(
  browser: { popup: Page; worker: Worker },
  origin: string,
  count: number,
  options: { prefix?: string; response?: string; title?: string } = {},
) {
  const popupUrl = browser.popup.url();
  const fixtureUrl = new URL(popupUrl);
  fixtureUrl.pathname = '/database-fixture.html';
  fixtureUrl.hash = '';
  await browser.popup.evaluate(async () => {
    const reply = await chrome.runtime.sendMessage({
      target: 'saul-workspace',
      message: { type: 'DB_UNREAD' },
    });
    if (!reply.success) throw new Error(reply.error);
  });
  // Unmount the reader and stop its runner before preparing fixture rows.
  // Restore normal routing afterward.
  await browser.popup.goto(fixtureUrl.toString());
  await browser.worker.evaluate(() => chrome.offscreen.closeDocument());
  try {
    const seeded = await runDatabaseFixture<{ selections: number; completed: number }>(
      browser.popup,
      { action: 'seed-history', seed: { origin, count, options } },
    );
    if (seeded.selections !== count || seeded.completed !== count)
      throw new Error('Fixture did not persist the requested completed records.');
  } finally {
    await browser.popup.goto(popupUrl);
  }
}
