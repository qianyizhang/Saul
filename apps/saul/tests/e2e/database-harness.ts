import type { Page, Worker } from '@playwright/test';
import type { DbRequest } from '../../src/types/storage';

export type DatabaseFixtureRequest =
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
    const worker = new Worker(chrome.runtime.getURL('database-fixture.js'), { type: 'module' });
    try {
      const result = await new Promise<unknown>((resolve, reject) => {
        worker.onmessage = ({ data }: MessageEvent<FixtureReply>) =>
          data.success ? resolve(data.result) : reject(new Error(data.error));
        worker.onerror = (event) => reject(new Error(event.message));
        worker.postMessage(request);
      });
      return result as T;
    } finally {
      worker.terminate();
    }
  }, request);
}

// Prepare persisted rows in the existing test-only OPFS worker.
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
  // Unmount the reader and release the production owner's OPFS handles before
  // the fixture worker opens that same database. Restore normal routing afterward.
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
