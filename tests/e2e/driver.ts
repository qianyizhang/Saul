import { expect, type Page } from '@playwright/test';
import type { DbOperations, DbRequest, DbType, HistoryItem, Reply } from '../../src/types/storage';
import type { WorkspaceRequest, WorkspaceResultFor } from '../../src/native/workspace';

export async function sendDb<K extends DbType>(
  page: Page,
  message: DbRequest<K>,
): Promise<DbOperations[K]['result']> {
  return page.evaluate(async (message) => {
    const reply = (await chrome.runtime.sendMessage({
      target: 'saul-workspace',
      message,
    })) as Reply<DbOperations[K]['result']> | undefined;
    if (!reply) throw new Error('Saul did not respond');
    if (!reply.success) throw new Error(reply.error);
    return reply.result;
  }, message);
}

export function getHistory(page: Page): Promise<HistoryItem[]> {
  return sendDb(page, { type: 'DB_GET_HISTORY', payload: {} });
}

export async function getFirstHistory(page: Page): Promise<HistoryItem> {
  const [first] = await getHistory(page);
  if (!first) throw new Error('Expected at least one saved reading');
  return first;
}

export async function sendWorkspace<T extends WorkspaceRequest>(
  page: Page,
  message: T,
): Promise<WorkspaceResultFor<T>> {
  return page.evaluate(async (message) => {
    const reply = (await chrome.runtime.sendMessage({
      type: 'WORKSPACE_TABS',
      ...message,
    })) as Reply<WorkspaceResultFor<T>> | undefined;
    if (!reply) throw new Error('Saul did not respond');
    if (!reply.success) throw new Error(reply.error);
    return reply.result;
  }, message);
}

export async function configureFixtureProvider(page: Page, origin: string): Promise<void> {
  await page.evaluate(async (origin) => {
    await chrome.storage.local.set({
      saul_user_settings: {
        activeProvider: 'openai-compatible',
        openaiCompatible: { baseUrl: origin + '/v1', apiKey: '', model: 'test-model' },
      },
    });
  }, origin);
}

export async function explainSelection(page: Page, selector = '#concept'): Promise<void> {
  await expect(page.locator('saul-root')).toBeAttached();
  await page.locator(selector).click({ clickCount: 3 });
  await page.getByRole('button', { name: 'Explain', exact: true }).click();
}

export async function openFirstPageExplanation(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Page explanations', exact: true }).click();
  await page
    .getByRole('region', { name: 'Page explanations', exact: true })
    .getByRole('button')
    .first()
    .click();
}
