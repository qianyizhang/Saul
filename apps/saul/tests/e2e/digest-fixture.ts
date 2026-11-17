import { expect, type Worker, type BrowserContext, type Page } from '@playwright/test';
import type { CredentialEvent, CredentialRequest } from '../../native/credentials-contract.mts';
import { DEFAULT_CONFIGURATION, type Configuration } from '../../src/configuration/definition';
import type { SharedPresets } from '../../native/shared-presets-contract.mts';
import type { PlanControlRequest } from '../../native/plan-protocol.mts';
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
    async ({ hold, failure, accounts, defaults }) => {
      const settings =
        ((await chrome.storage.local.get('saul_user_settings'))
          .saul_user_settings as Configuration) || defaults;
      const savedFixture = (await chrome.storage.local.get('digest_fixture_config'))
        .digest_fixture_config as
        | {
            library: SharedPresets;
            sections: Record<string, { revision: number; value?: Record<string, unknown> }>;
          }
        | undefined;
      if (settings.sharedCredentials !== 'saul' || savedFixture) {
        const connections = settings.connections.map((c) =>
          c.key === 'gpt-plan' ? { ...c, accountId: accounts[0]?.id } : c,
        );
        await chrome.storage.local.set({
          saul_user_settings: { ...settings, connections, sharedCredentials: 'saul' },
        });
        let library: SharedPresets = savedFixture?.library ?? {
          revision: 1,
          connections,
          presets: [],
        };
        const sections: Record<string, { revision: number; value?: Record<string, unknown> }> =
          savedFixture?.sections ?? {};
        await chrome.storage.local.set({ digest_fixture_config: { library, sections } });
        chrome.runtime.sendNativeMessage = (async (
          host: string,
          packet: { id: string; request: PlanControlRequest },
        ) => {
          if (host !== 'com.saul.chatgpt')
            throw new Error('Configuration must use the storage helper');
          const r = packet.request;
          let result: Record<string, unknown>;
          if (r.action === 'presets-read') result = { library };
          else if (r.action === 'config-read')
            result = { config: sections[r.section] ?? { revision: 0 } };
          else if (r.action === 'config-save' || r.action === 'config-commit') {
            if ((sections[r.section]?.revision ?? 0) !== r.revision)
              throw new Error('Scoped settings changed');
            if (r.action === 'config-commit') {
              if (r.presetRevision !== library.revision) throw new Error('Shared settings changed');
              library = {
                revision: library.revision + 1,
                connections: r.connections ?? library.connections,
                presets: r.presets,
              };
            }
            sections[r.section] = { revision: r.revision + 1, value: r.value };
            await chrome.storage.local.set({ digest_fixture_config: { library, sections } });
            result = {
              config: sections[r.section],
              ...(r.action === 'config-commit' ? { library } : {}),
            };
          } else throw new Error('Unexpected summary settings operation: ' + r.action);
          return { id: packet.id, event: { type: 'result', ...result } };
        }) as typeof chrome.runtime.sendNativeMessage;
      }
      const state = {
        requests: [] as PlanRequest[],
        accounts,
        hold,
        active: 0,
        maxActive: 0,
        finishes: new Map<string, () => void>(),
      };
      Object.assign(globalThis, { digestFixture: state });
      const original = chrome.runtime.connectNative.bind(chrome.runtime);
      chrome.runtime.connectNative = ((host: string) => {
        if (host !== 'com.saul.credentials') return original(host);
        const listeners: ((m: { id: string; event: PlanEvent | CredentialEvent }) => void)[] = [];
        return {
          onMessage: {
            addListener: (fn: (m: { id: string; event: PlanEvent | CredentialEvent }) => void) =>
              listeners.push(fn),
          },
          onDisconnect: { addListener: () => {} },
          disconnect: () => {},
          postMessage: (message: {
            version: number;
            id: string;
            request: PlanRequest | Extract<CredentialRequest, { action: 'connection-catalog' }>;
            cancel?: boolean;
          }) => {
            if (message.cancel) {
              if (state.finishes.delete(message.id)) state.active--;
              return;
            }
            if (message.version !== 2) throw new Error('Expected signed credential protocol v2');
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
    { hold, failure, accounts, defaults: DEFAULT_CONFIGURATION },
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
