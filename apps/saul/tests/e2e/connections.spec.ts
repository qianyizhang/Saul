import { test, expect } from './fixtures.ts';
import { configureFixtureProvider, settingsSection } from './driver.ts';
import { DEFAULT_CONFIGURATION } from '../../src/configuration/definition';
import type { Configuration } from '../../src/configuration/definition';
import type { SharedPresets } from '../../shared/protocol/shared-presets-contract.mts';
import type { StorageHelperRequest } from '../../shared/protocol/storage-protocol.mts';
import type {
  CredentialRequest,
  CredentialEvent,
} from '../../shared/protocol/credentials-contract.mts';
import type { Worker } from '@playwright/test';

type ConnectionFixture = {
  denied: boolean;
  removed: boolean;
  library: SharedPresets;
  sections: Record<string, { revision: number; value?: Record<string, unknown> }>;
  requests: CredentialRequest[];
  cancellations: CredentialRequest[];
  holdDisplays: boolean;
  heldDisplays: (() => void)[];
  rejectLogout: boolean;
  signedOut: boolean;
  holdSignedOutStatus: boolean;
  heldStatuses: (() => void)[];
};
type FixtureGlobal = typeof globalThis & { connectionFixture: ConnectionFixture };

async function configureConnections(worker: Worker) {
  await worker.evaluate(async (defaults) => {
    const state: ConnectionFixture = {
      denied: true,
      removed: false,
      holdDisplays: false,
      heldDisplays: [],
      rejectLogout: false,
      signedOut: false,
      holdSignedOutStatus: false,
      heldStatuses: [],
      cancellations: [],
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
      },
      sections: {},
      requests: [],
    };
    Object.assign(globalThis, { connectionFixture: state });
    await chrome.storage.local.set({
      saul_user_settings: { ...defaults, sharedCredentials: 'saul' },
    });
    setStorageControlFixture(
      async (_host: string, message: { id: string; request: StorageHelperRequest }) => {
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
      },
    );
    const original = chrome.runtime.connectNative.bind(chrome.runtime);
    chrome.runtime.connectNative = ((host: string) => {
      if (host !== 'com.saul.credentials') return original(host);
      const listeners: ((packet: { id: string; event: CredentialEvent }) => void)[] = [];
      let initialRequest: CredentialRequest | undefined;
      return {
        onMessage: { addListener: (fn: (typeof listeners)[number]) => listeners.push(fn) },
        onDisconnect: { addListener: () => {} },
        disconnect: () => {},
        postMessage: (
          message: { version: number; id: string } & (
            { request: CredentialRequest } | { cancel: true }
          ),
        ) => {
          if (message.version !== 2) throw new Error('Expected signed credential protocol v2');
          if ('cancel' in message) {
            if (initialRequest) state.cancellations.push(initialRequest);
            return;
          }
          const r = (initialRequest = message.request);
          state.requests.push(r);
          const send = (event: CredentialEvent) =>
            listeners.forEach((fn) => fn({ id: message.id, event }));
          queueMicrotask(() => {
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
            else if (r.action === 'login') {
              if (r.accountId === 'fixture-account') state.signedOut = false;
              event = {
                type: 'result',
                account: {
                  id: r.accountId ?? 'fixture-new',
                  label: 'alex@example.com',
                  signedIn: true,
                  planEnabled: true,
                },
              };
            } else if (r.action === 'logout') {
              if (state.rejectLogout) {
                send({ type: 'error', message: 'Could not write the local account change.' });
                return;
              }
              state.signedOut = true;
              event = {
                type: 'result',
                account: {
                  id: r.accountId,
                  label: 'alex@example.com',
                  signedIn: false,
                  planEnabled: false,
                },
                warning: 'Signed out locally. Remote revocation was not confirmed.',
              };
            } else if (r.action === 'connection-status') {
              const provider = state.library.connections?.find((p) => p.key === r.connectionKey);
              event = {
                type: 'result',
                connection:
                  provider?.kind === 'chatgpt-plan'
                    ? {
                        connected: !state.signedOut,
                        identity: state.signedOut
                          ? 'alex@example.com · registration'
                          : 'alex@example.com',
                        signedIn: !state.signedOut,
                      }
                    : {
                        connected: true,
                        endpoint: provider?.baseUrl ?? 'https://api.openai.com/v1',
                        keySuffix: '7K2m',
                      },
              };
              if (
                provider?.kind === 'chatgpt-plan' &&
                state.signedOut &&
                state.holdSignedOutStatus
              ) {
                state.heldStatuses.push(() => send(event));
                return;
              }
            } else if (r.action === 'connection-catalog') {
              if (
                r.connectionKey === 'openai-api' &&
                r.intent === 'display' &&
                state.holdDisplays
              ) {
                state.heldDisplays.push(() =>
                  send({ type: 'error', message: 'Stale passive catalog reply.' }),
                );
                return;
              }
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
                          ...(r.intent ? { isDefault: true } : {}),
                        },
                      ],
                },
              };
            } else if (r.action === 'api-chat') {
              send({ type: 'delta', text: 'Hello from the managed test.' });
              send({ type: 'complete' });
              return;
            } else if (r.action === 'connection-key-save')
              event = state.denied
                ? { type: 'error', message: 'Synthetic key storage denied' }
                : { type: 'result' };
            else event = { type: 'error', message: 'Unexpected credential operation' };
            send(event);
          });
        },
      } as unknown as chrome.runtime.Port;
    }) as typeof chrome.runtime.connectNative;
  }, DEFAULT_CONFIGURATION);
}

test('managed connections preserve setup after failure and report removed models without rewriting presets', async ({
  sandbox,
}, info) => {
  const { worker, popup } = await sandbox.launch();
  await configureConnections(worker);
  await popup.reload();
  await popup.setViewportSize({ width: 640, height: 760 });
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  const savedBeforeInspection = await worker.evaluate(
    async () =>
      (await chrome.storage.local.get('saul_user_settings')).saul_user_settings as Configuration,
  );
  await settingsSection(popup, 'Presets');
  await popup.getByRole('button', { name: 'Writing', exact: true }).click();
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
  await popup.evaluate(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime) as (
      message: unknown,
    ) => Promise<unknown>;
    const state = globalThis as typeof globalThis & { connectionCommitCount: number };
    state.connectionCommitCount = 0;
    chrome.runtime.sendMessage = (async (message: {
      target?: string;
      message?: { action?: string };
    }) => {
      const reply = await original(message);
      if (message.target === 'saul-settings' && message.message?.action === 'commit') {
        state.connectionCommitCount++;
        return { success: false, error: 'Synthetic failure after saving the connection.' };
      }
      return reply;
    }) as typeof chrome.runtime.sendMessage;
  });
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    popup.getByRole('alert').filter({ hasText: 'Synthetic failure after saving' }),
  ).toBeVisible();
  await expect(
    popup.getByRole('button', { name: 'Reload saved settings', exact: true }),
  ).toBeVisible();
  await expect(
    popup
      .getByRole('region', { name: 'Connections', exact: true })
      .getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled();
  await popup.screenshot({ path: info.outputPath('connection-recovery.png') });
  await popup.setViewportSize({ width: 390, height: 850 });
  await popup.emulateMedia({ colorScheme: 'dark' });
  expect(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await popup.screenshot({ path: info.outputPath('connection-recovery-dark-narrow.png') });
  await popup.setViewportSize({ width: 640, height: 760 });
  await popup.emulateMedia({ colorScheme: 'light' });
  await popup.getByRole('button', { name: 'Review latest', exact: true }).click();
  await popup.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  await popup.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(
    await popup.evaluate(
      () =>
        (globalThis as typeof globalThis & { connectionCommitCount: number }).connectionCommitCount,
    ),
  ).toBe(1);
  const local = popup.getByRole('article', { name: 'Local development', exact: true });
  await expect(local.getByText('Write', { exact: true })).toBeVisible();
  await expect(local.getByText(/localhost:11434/)).toBeVisible();
  await popup.setViewportSize({ width: 390, height: 850 });
  await popup.emulateMedia({ colorScheme: 'dark' });
  await popup.screenshot({ path: info.outputPath('connections-dark-narrow.png') });
  expect(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await settingsSection(popup, 'Presets');
  await expect(popup.getByLabel('Preset', { exact: true })).toHaveValue(
    'c14b29f3-3ec2-4efc-8bed-e05531aef2cb',
  );
  const savedAfterConnection = await worker.evaluate(
    async () =>
      (await chrome.storage.local.get('saul_user_settings')).saul_user_settings as Configuration,
  );
  expect(savedAfterConnection.openaiCompatible).toEqual(savedBeforeInspection.openaiCompatible);
  expect(savedAfterConnection.activeProvider).toBe(savedBeforeInspection.activeProvider);
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

test('a managed preset links to its connection, where Check replaces a passive request', async ({
  sandbox,
}, info) => {
  const { worker, popup } = await sandbox.launch();
  await configureConnections(worker);
  await popup.reload();
  await popup.setViewportSize({ width: 390, height: 850 });
  await popup.emulateMedia({ colorScheme: 'dark' });
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(popup, 'Presets');
  const preset = popup.getByRole('region', { name: 'Presets', exact: true });
  await preset.getByLabel('Preset', { exact: true }).selectOption({ label: 'Writing' });
  await preset.getByLabel('Preset name', { exact: true }).fill('Writing draft');
  await popup.evaluate(() => {
    const original = globalThis.fetch.bind(globalThis);
    const endpointRequests: string[] = [];
    Object.assign(globalThis, { endpointRequests });
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input, location.href);
      if (url.origin === 'https://api.openai.com') {
        endpointRequests.push(url.pathname);
        throw new Error('A managed endpoint must be accessed through the credential owner.');
      }
      return original(input, init);
    };
  });
  await preset.getByLabel('Model options and tests', { exact: true }).click();
  await expect(preset.getByRole('button', { name: 'Test Connection', exact: true })).toHaveCount(0);
  await expect(preset.getByRole('button', { name: 'Test generation', exact: true })).toBeEnabled();
  const openConnections = preset.getByRole('button', { name: 'Connections', exact: true });
  await openConnections.scrollIntoViewIfNeeded();
  await popup.screenshot({ path: info.outputPath('managed-preset-dark-narrow.png') });

  await worker.evaluate(() => {
    (globalThis as FixtureGlobal).connectionFixture.holdDisplays = true;
  });
  await openConnections.click();
  const api = popup.getByRole('article', { name: 'OpenAI API', exact: true });
  await expect(api).toBeFocused();
  await expect
    .poll(() =>
      worker.evaluate(() => (globalThis as FixtureGlobal).connectionFixture.heldDisplays.length),
    )
    .toBeGreaterThan(0);
  await expect(api.getByRole('status')).toHaveText('Checking…');
  const check = api.getByRole('button', { name: 'Check', exact: true });
  await expect(check).toBeEnabled();
  await popup.keyboard.press('Tab');
  await expect(api.getByLabel('More for OpenAI API')).toBeFocused();
  await check.click();
  await expect(api.getByRole('status')).toHaveText('✓ Connected');
  const beforeGeneration = await worker.evaluate(() => {
    const state = (globalThis as FixtureGlobal).connectionFixture;
    return {
      explicit: state.requests.filter(
        (r) => r.action === 'connection-catalog' && r.intent === 'check',
      ),
      generation: state.requests.filter((r) => r.action === 'api-chat'),
    };
  });
  expect(beforeGeneration.explicit).toEqual([
    { action: 'connection-catalog', connectionKey: 'openai-api', intent: 'check' },
  ]);
  expect(beforeGeneration.generation).toHaveLength(0);
  await expect
    .poll(() =>
      worker.evaluate(() =>
        (globalThis as FixtureGlobal).connectionFixture.cancellations.some(
          (r) =>
            r.action === 'connection-catalog' &&
            r.connectionKey === 'openai-api' &&
            r.intent === 'display',
        ),
      ),
    )
    .toBe(true);

  await worker.evaluate(() => {
    const state = (globalThis as FixtureGlobal).connectionFixture;
    state.holdDisplays = false;
    for (const respond of state.heldDisplays.splice(0)) respond();
  });
  await expect(api.getByRole('status')).toHaveText('✓ Connected');
  await expect(api.getByRole('alert')).toHaveCount(0);
  await settingsSection(popup, 'Presets');
  await expect(preset.getByLabel('Model name', { exact: true })).toHaveValue('future-model');
  await expect(preset.getByLabel('Preset name', { exact: true })).toHaveValue('Writing draft');
  await preset.getByRole('button', { name: 'Test generation', exact: true }).click();
  await expect(popup.getByText('Generation succeeded: Hello from the managed test.')).toBeVisible();
  const generation = await worker.evaluate(() =>
    (globalThis as FixtureGlobal).connectionFixture.requests.filter((r) => r.action === 'api-chat'),
  );
  expect(generation).toEqual([
    expect.objectContaining({ connectionKey: 'openai-api', model: 'future-model' }),
  ]);
  expect(
    await popup.evaluate(
      () => (globalThis as typeof globalThis & { endpointRequests: string[] }).endpointRequests,
    ),
  ).toEqual([]);
});

test('signed-out status and the revocation warning survive the follow-up status read', async ({
  sandbox,
}, info) => {
  const { worker, popup } = await sandbox.launch();
  await configureConnections(worker);
  await worker.evaluate(() => {
    const state = (globalThis as FixtureGlobal).connectionFixture;
    state.rejectLogout = true;
    state.holdSignedOutStatus = true;
  });
  await popup.reload();
  await popup.setViewportSize({ width: 640, height: 760 });
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(popup, 'Connections');
  const plan = popup.getByRole('article', { name: 'ChatGPT plan', exact: true });
  const revokeWarning = plan.getByText(/Remote revocation was not confirmed/);
  const signOut = plan.getByRole('button', { name: 'Sign out', exact: true });
  const signOutStatus = plan.getByText('Signed out', { exact: true });
  await expect(plan.getByRole('status')).toHaveText('✓ Connected');

  let confirmation = '';
  popup.once('dialog', async (dialog) => {
    confirmation = dialog.message();
    await dialog.accept();
  });
  await plan.getByLabel('More for ChatGPT plan').click();
  await signOut.click();
  await expect(popup.getByText('Could not write the local account change.')).toBeVisible();
  expect(confirmation).toContain('in both Saul and EZ');
  await expect(plan.getByRole('status')).toHaveText('✓ Connected');
  await expect(revokeWarning).toHaveCount(0);

  await worker.evaluate(() => {
    (globalThis as FixtureGlobal).connectionFixture.rejectLogout = false;
  });
  popup.once('dialog', (dialog) => dialog.accept());
  await signOut.click();
  await expect(signOutStatus).toBeVisible();
  await expect(revokeWarning).toBeVisible();
  await expect
    .poll(() =>
      worker.evaluate(() => (globalThis as FixtureGlobal).connectionFixture.heldStatuses.length),
    )
    .toBe(1);
  await worker.evaluate(() => {
    for (const respond of (globalThis as FixtureGlobal).connectionFixture.heldStatuses.splice(0))
      respond();
  });
  await expect(plan.getByText('alex@example.com · registration', { exact: true })).toBeVisible();
  await expect(signOutStatus).toBeVisible();
  await expect(revokeWarning).toBeVisible();
  await expect(plan.getByRole('button', { name: 'Set up', exact: true })).toBeEnabled();
  await popup.screenshot({ path: info.outputPath('connection-signed-out.png') });
});

test('standalone endpoint Check stays separate from generation', async ({
  sandbox,
  fixtureServer,
}) => {
  const requestsBeforeCheck = fixtureServer.requests.length;
  const { popup } = await sandbox.launch();
  await configureFixtureProvider(popup, fixtureServer.origin);
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(popup, 'Presets');
  await popup.getByLabel('Model options and tests', { exact: true }).click();
  await popup.getByRole('button', { name: 'Test Connection', exact: true }).click();
  await expect(popup.getByText(/Endpoint reachable/)).toBeVisible();
  expect(fixtureServer.requests).toHaveLength(requestsBeforeCheck);
});
