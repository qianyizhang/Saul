import type { Page } from '@playwright/test';
import type { DbRequest } from '../../src/types/storage';

export type DatabaseFixtureRequest =
  | { action: 'migrate'; legacy: string }
  | { action: 'scale'; runs: number }
  | { action: 'db'; message: DbRequest };

interface FixtureReply {
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface MigrationReport {
  rollback: { failed: boolean; version: number; columns: string[]; bookmark: number };
  upgraded: { version: number; response: string; viewed: number; bookmark: number; search: number };
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
