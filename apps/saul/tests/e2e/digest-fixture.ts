import { expect, type Worker, type BrowserContext, type Page } from '@playwright/test';
import type { CredentialEvent, CredentialRequest } from '../../native/credentials-contract.mts';
import type { PlanRequest, PlanEvent, PlanAccount } from '../../native/plan-protocol.mts';
export async function installDigestProvider(
  worker: Worker,
  hold = false,
  failure?: string,
  accounts: PlanAccount[] = [
    { id: 'fixture', label: 'Fixture', signedIn: true, planEnabled: true },
  ],
) {
  await worker.evaluate(
    ({ hold, failure, accounts }) => {
      const state = {
        requests: [] as PlanRequest[],
        accounts,
        hold,
        active: 0,
        maxActive: 0,
        finishes: new Map<string, () => void>(),
      };
      Object.assign(globalThis, { digestFixture: state });
      chrome.runtime.connectNative = (() => {
        const listeners: ((m: { id: string; event: PlanEvent | CredentialEvent }) => void)[] = [];
        return {
          onMessage: {
            addListener: (fn: (m: { id: string; event: PlanEvent | CredentialEvent }) => void) =>
              listeners.push(fn),
          },
          onDisconnect: { addListener: () => {} },
          disconnect: () => {},
          postMessage: (message: {
            id: string;
            request: PlanRequest | Extract<CredentialRequest, { action: 'connection-catalog' }>;
            cancel?: boolean;
          }) => {
            if (message.cancel) {
              if (state.finishes.delete(message.id)) state.active--;
              return;
            }
            const emit = (event: PlanEvent) =>
              listeners.forEach((fn) => fn({ id: message.id, event }));
            const request = message.request;
            if (request.action !== 'connection-catalog') state.requests.push(request);
            queueMicrotask(() => {
              if (request.action === 'connection-catalog')
                listeners.forEach((fn) =>
                  fn({
                    id: message.id,
                    event: {
                      type: 'result',
                      catalog: {
                        fetchedAt: Date.now(),
                        models: ['gpt-6-luna', 'fixture-work-model'].map((id) => ({
                          id,
                          name: id,
                          capabilities: ['write'],
                          efforts: ['medium', 'high'],
                          defaultEffort: 'medium',
                        })),
                      },
                    },
                  }),
                );
              else if (request.action === 'accounts')
                emit({
                  type: 'result',
                  accounts: state.accounts,
                });
              else if (message.request.action === 'models')
                emit({
                  type: 'result',
                  models: [
                    {
                      slug: 'gpt-6-luna',
                      display_name: 'Luna',
                      supportedReasoningEfforts: [{ effort: 'medium', description: 'Medium' }],
                      defaultReasoningEffort: 'medium',
                      isDefault: true,
                    },
                  ],
                });
              else if (message.request.action === 'generate') {
                if (failure) {
                  emit({ type: 'error', message: failure });
                  return;
                }
                state.active++;
                state.maxActive = Math.max(state.maxActive, state.active);
                const p = { en: 'A concise source-backed finding.', zh: '简明且基于来源的结论。' };
                const finish = () => {
                  if (!state.finishes.delete(message.id)) return;
                  state.active--;
                  emit({
                    type: 'delta',
                    text: JSON.stringify({
                      lead: p,
                      points: [p, p],
                      caution: null,
                      flow: [],
                      terms: [],
                      question: null,
                    }),
                  });
                  emit({ type: 'complete' });
                };
                state.finishes.set(message.id, finish);
                if (!state.hold) finish();
              }
            });
          },
        } as unknown as chrome.runtime.Port;
      }) as typeof chrome.runtime.connectNative;
    },
    { hold, failure, accounts },
  );
}

export async function openDigestReader(
  context: BrowserContext,
  popup: Page,
  worker: Worker,
  url: string,
) {
  const tabId = await worker.evaluate(
    async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)!.id!,
    url,
  );
  await expect
    .poll(() => worker.evaluate(async (id) => (await chrome.tabs.get(id)).status, tabId))
    .toBe('complete');
  const opened = context.waitForEvent('page');
  await popup.evaluate(
    (tabId) =>
      chrome.runtime.sendMessage({
        type: 'WORKSPACE_TABS',
        action: 'command',
        method: 'saul_summary_open',
        args: { tabIds: [tabId] },
      }),
    tabId,
  );
  return opened;
}
