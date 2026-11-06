import { test, expect } from './fixtures.ts';
import { settingsSection } from './driver.ts';
import { DEFAULT_SETTINGS } from '../../src/storage/settings';
import type { SharedPresets } from '../../native/shared-presets-contract.mts';
import type { PlanControlRequest } from '../../native/plan-protocol.mts';
import type { CredentialRequest, CredentialEvent } from '../../native/credentials-contract.mts';

test('managed connections preserve setup after failure and report removed models without rewriting presets', async ({
  sandbox,
}, info) => {
  const { worker, popup } = await sandbox.launch();
  await worker.evaluate(async (defaults) => {
    const state = {
      denied: true,
      removed: false,
      library: {
        revision: 1,
        connections: [
          {
            key: 'gpt-plan',
            name: 'ChatGPT plan',
            kind: 'chatgpt-plan',
            accountId: 'fixture-account',
          },
          {
            key: 'openai-api',
            name: 'OpenAI API',
            kind: 'openai-api',
            baseUrl: 'https://api.openai.com/v1',
          },
        ],
        presets: [
          {
            id: 'c14b29f3-3ec2-4efc-8bed-e05531aef2cb',
            name: 'Writing',
            connectionKey: 'openai-api',
            capability: 'write',
            model: 'future-model',
            effort: '',
            fast: false,
          },
        ],
      } as SharedPresets,
      sections: {} as Record<string, { revision: number; value?: Record<string, unknown> }>,
      requests: [] as CredentialRequest[],
    };
    Object.assign(globalThis, { connectionFixture: state });
    await chrome.storage.local.set({
      saul_user_settings: { ...defaults, sharedCredentials: 'saul' },
    });
    chrome.runtime.sendNativeMessage = (async (
      _host: string,
      message: { id: string; request: PlanControlRequest },
    ) => {
      const r = message.request;
      let result: Record<string, unknown>;
      if (r.action === 'presets-read') result = { library: state.library };
      else if (r.action === 'config-read')
        result = { config: state.sections[r.section] ?? { revision: 0 } };
      else if (r.action === 'config-save') {
        state.sections[r.section] = { revision: r.revision + 1, value: r.value };
        result = { config: state.sections[r.section] };
      } else if (r.action === 'config-commit') {
        if (r.presetRevision !== state.library.revision)
          throw new Error('Settings changed. Reload.');
        state.library = {
          revision: r.presetRevision + 1,
          connections: r.connections ?? state.library.connections,
          presets: r.presets,
        };
        state.sections[r.section] = { revision: r.revision + 1, value: r.value };
        result = { library: state.library, config: state.sections[r.section] };
      } else throw new Error('Unexpected settings operation');
      return { id: message.id, event: { type: 'result', ...result } };
    }) as typeof chrome.runtime.sendNativeMessage;
    chrome.runtime.connectNative = (() => {
      const listeners: ((packet: { id: string; event: CredentialEvent }) => void)[] = [];
      return {
        onMessage: { addListener: (fn: (typeof listeners)[number]) => listeners.push(fn) },
        onDisconnect: { addListener: () => {} },
        disconnect: () => {},
        postMessage: (message: { id: string; request: CredentialRequest }) => {
          state.requests.push(message.request);
          queueMicrotask(() => {
            const r = message.request;
            let event: CredentialEvent;
            if (r.action === 'accounts')
              event = {
                type: 'result',
                accounts: [
                  {
                    id: 'fixture-account',
                    label: 'alex@example.com',
                    signedIn: true,
                    planEnabled: true,
                  },
                  {
                    id: 'fixture-spare',
                    label: 'alex@example.com · spare',
                    signedIn: true,
                    planEnabled: true,
                  },
                ],
              };
            else if (r.action === 'login')
              event = {
                type: 'result',
                account: {
                  id: r.accountId ?? 'fixture-new',
                  label: 'alex@example.com',
                  signedIn: true,
                  planEnabled: true,
                },
              };
            else if (r.action === 'connection-status') {
              const provider = state.library.connections?.find((p) => p.key === r.connectionKey);
              event = {
                type: 'result',
                connection:
                  provider?.kind === 'chatgpt-plan'
                    ? { connected: true, identity: 'alex@example.com', signedIn: true }
                    : {
                        connected: true,
                        endpoint: provider?.baseUrl ?? 'https://api.openai.com/v1',
                        keySuffix: '7K2m',
                      },
              };
            } else if (r.action === 'connection-catalog')
              event = {
                type: 'result',
                catalog: {
                  fetchedAt: Date.now() / 1000,
                  models: state.removed
                    ? []
                    : [
                        {
                          id: 'future-model',
                          name: 'Future model',
                          capabilities: ['write'],
                          efforts: [],
                          defaultEffort: '',
                        },
                      ],
                },
              };
            else if (r.action === 'connection-key-save')
              event = state.denied
                ? { type: 'error', message: 'Synthetic key storage denied' }
                : { type: 'result' };
            else event = { type: 'error', message: 'Unexpected credential operation' };
            listeners.forEach((fn) => fn({ id: message.id, event }));
          });
        },
      } as unknown as chrome.runtime.Port;
    }) as typeof chrome.runtime.connectNative;
  }, DEFAULT_SETTINGS);
  await popup.reload();
  await popup.setViewportSize({ width: 640, height: 760 });
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(popup, 'Connections');
  const plan = popup.getByRole('article', { name: 'ChatGPT plan', exact: true });
  await expect(plan.getByText('alex@example.com', { exact: true })).toBeVisible();
  await expect(plan.locator('.connection-capabilities code')).toHaveText(['Write']);
  await expect(
    popup.getByRole('article', { name: 'OpenAI API', exact: true }).getByText(/sk-\*\*\*7K2m/),
  ).toBeVisible();
  await popup.screenshot({ path: info.outputPath('connections-light.png') });
  await plan.getByLabel('More for ChatGPT plan').click();
  await plan.getByRole('button', { name: 'Sign in again', exact: true }).click();
  await expect(popup.getByRole('combobox', { name: 'Account', exact: true })).toBeDisabled();
  await expect(popup.getByRole('combobox', { name: 'Account', exact: true })).toHaveValue(
    'fixture-account',
  );
  await expect(popup.getByRole('button', { name: 'Add another account', exact: true })).toHaveCount(
    0,
  );
  await popup.getByRole('button', { name: 'Sign in and allow plan use', exact: true }).click();
  await expect
    .poll(() =>
      worker.evaluate(() =>
        (
          globalThis as unknown as { connectionFixture: { requests: CredentialRequest[] } }
        ).connectionFixture.requests.filter((r) => r.action === 'login'),
      ),
    )
    .toEqual([{ action: 'login', accountId: 'fixture-account', consent: true }]);
  await popup.getByRole('button', { name: 'Cancel', exact: true }).click();
  await popup.getByRole('button', { name: '＋ Add', exact: true }).click();
  await expect(
    popup.getByRole('button', { name: 'Sign in and allow plan use', exact: true }),
  ).toBeDisabled();
  await popup.getByRole('combobox', { name: 'Account', exact: true }).selectOption('fixture-spare');
  await popup.getByRole('button', { name: 'Sign in and allow plan use', exact: true }).click();
  await expect
    .poll(() =>
      worker.evaluate(() =>
        (
          globalThis as unknown as { connectionFixture: { requests: CredentialRequest[] } }
        ).connectionFixture.requests
          .filter((r) => r.action === 'login')
          .at(-1),
      ),
    )
    .toEqual({ action: 'login', accountId: 'fixture-spare', consent: true });
  await popup.screenshot({ path: info.outputPath('reuse-account.png') });
  await popup.getByRole('button', { name: 'Add another account', exact: true }).click();
  await expect
    .poll(() =>
      worker.evaluate(() =>
        (
          globalThis as unknown as { connectionFixture: { requests: CredentialRequest[] } }
        ).connectionFixture.requests
          .filter((r) => r.action === 'login')
          .at(-1),
      ),
    )
    .toEqual({ action: 'login', consent: true });
  await popup.getByRole('button', { name: 'Cancel', exact: true }).click();
  await popup.getByRole('button', { name: '＋ Add', exact: true }).click();
  await popup.getByRole('combobox', { name: 'Type', exact: true }).selectOption('custom');
  await popup.getByLabel('Name', { exact: true }).fill('Local development');
  await popup.getByLabel('Endpoint', { exact: true }).fill('http://localhost:11434/v1');
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    popup.getByRole('alert').filter({ hasText: 'Synthetic key storage denied' }),
  ).toBeVisible();
  await expect(popup.getByLabel('Name', { exact: true })).toHaveValue('Local development');
  await worker.evaluate(() => {
    (globalThis as unknown as { connectionFixture: { denied: boolean } }).connectionFixture.denied =
      false;
  });
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  const local = popup.getByRole('article', { name: 'Local development', exact: true });
  await expect(local.getByText('Write', { exact: true })).toBeVisible();
  await expect(local.getByText(/localhost:11434/)).toBeVisible();
  await popup.setViewportSize({ width: 390, height: 850 });
  await popup.emulateMedia({ colorScheme: 'dark' });
  await popup.screenshot({ path: info.outputPath('connections-dark-narrow.png') });
  expect(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await settingsSection(popup, 'Presets');
  await popup
    .getByLabel('Preset', { exact: true })
    .selectOption('c14b29f3-3ec2-4efc-8bed-e05531aef2cb');
  await expect(popup.getByLabel('Model name', { exact: true })).toHaveValue('future-model');
  await worker.evaluate(() => {
    (
      globalThis as unknown as { connectionFixture: { removed: boolean } }
    ).connectionFixture.removed = true;
  });
  await popup.getByRole('button', { name: 'History', exact: true }).click();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(
    popup.getByRole('alert').filter({ hasText: 'no longer available' }).first(),
  ).toBeVisible();
  await popup.getByRole('button', { name: 'Edit preset', exact: true }).first().click();
  await expect(
    popup.getByRole('alert').filter({ hasText: 'no longer available' }).first(),
  ).toBeVisible();
  await expect(popup.getByLabel('Model name', { exact: true })).toHaveValue('future-model');
  await popup.screenshot({ path: info.outputPath('model-removed.png') });
  const saved = await worker.evaluate(
    () =>
      (
        globalThis as unknown as {
          connectionFixture: { library: SharedPresets; requests: CredentialRequest[] };
        }
      ).connectionFixture,
  );
  expect(saved.library.presets[0]?.model).toBe('future-model');
  const saves = saved.requests.filter((r) => r.action === 'connection-key-save');
  expect(saves).toHaveLength(2);
  expect(saves[0]).toEqual(saves[1]);
});
