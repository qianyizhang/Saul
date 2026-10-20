import type { Worker } from '@playwright/test';
import type { PlanRequest, PlanEvent } from '../../native/plan-protocol.mjs';
export async function installDigestProvider(worker: Worker, hold = false) {
  await worker.evaluate((hold) => {
    const state = {
      requests: [] as PlanRequest[],
      hold,
      active: 0,
      maxActive: 0,
      finishes: new Map<string, () => void>(),
    };
    Object.assign(globalThis, { digestFixture: state });
    chrome.runtime.connectNative = (() => {
      const listeners: ((m: { id: string; event: PlanEvent }) => void)[] = [];
      return {
        onMessage: {
          addListener: (fn: (m: { id: string; event: PlanEvent }) => void) => listeners.push(fn),
        },
        onDisconnect: { addListener: () => {} },
        disconnect: () => {},
        postMessage: (message: { id: string; request: PlanRequest; cancel?: boolean }) => {
          if (message.cancel) {
            if (state.finishes.delete(message.id)) state.active--;
            return;
          }
          const emit = (event: PlanEvent) =>
            listeners.forEach((fn) => fn({ id: message.id, event }));
          state.requests.push(message.request);
          queueMicrotask(() => {
            if (message.request.action === 'accounts')
              emit({
                type: 'result',
                accounts: [{ id: 'fixture', label: 'Fixture', signedIn: true, planEnabled: true }],
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
  }, hold);
}
