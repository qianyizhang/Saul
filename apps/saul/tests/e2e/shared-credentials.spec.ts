import { test, expect } from './fixtures.ts';
import { settingsSection } from './driver.ts';
import type {
  CredentialRequest,
  CredentialEvent,
} from '../../shared/protocol/credentials-contract.mts';
import type { Configuration } from '../../src/configuration/definition';
import { DEFAULT_CONFIGURATION } from '../../src/configuration/definition';

test('shared credential opt-in preserves saved keys, verifies the owner and disconnects without fallback', async ({
  sandbox,
}, info) => {
  const { worker, popup } = await sandbox.launch();
  await worker.evaluate(async (defaults) => {
    const key = 'saul_user_settings';
    const saved = ((await chrome.storage.local.get(key))[key] as Configuration) || defaults;
    const official = {
      ...saved.openaiCompatible,
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'fixture-official-key',
    };
    const settings: Configuration = {
      ...saved,
      activeProvider: 'openai-compatible',
      openaiCompatible: official,
      activeProfileId: 'official',
      profiles: [
        { id: 'official', name: 'Official fixture', config: official },
        {
          id: 'custom',
          name: 'Custom fixture',
          config: { ...official, baseUrl: 'https://custom.test/v1', apiKey: 'fixture-custom-key' },
        },
      ],
      connectionProfiles: { ...saved.connectionProfiles, 'openai-api': 'official' },
      configuration: {
        ...saved.configuration!,
        presets: [
          ...saved.configuration!.presets,
          {
            id: 'inspect-custom',
            name: 'Inspect custom',
            provider: 'openai-compatible',
            profileId: 'custom',
            model: 'custom-model',
          },
        ],
      },
    };
    await chrome.storage.local.set({
      [key]: settings,
      saul_user_settings_recovery_backup: settings,
    });
    const original = chrome.runtime.connectNative.bind(chrome.runtime);
    const state = {
      denied: true,
      connected: false,
      requests: [] as CredentialRequest[],
    };
    Object.assign(globalThis, { credentialFixture: state });
    chrome.runtime.connectNative = ((host: string) => {
      if (host !== 'com.saul.credentials') return original(host);
      const listeners: ((packet: { id: string; event: CredentialEvent }) => void)[] = [];
      return {
        onMessage: {
          addListener: (fn: (packet: { id: string; event: CredentialEvent }) => void) =>
            listeners.push(fn),
        },
        onDisconnect: { addListener: () => {} },
        disconnect: () => {},
        postMessage: (message: { version: number; id: string; request: CredentialRequest }) => {
          if (message.version !== 2) throw new Error('Expected signed credential protocol v2');
          state.requests.push(message.request);
          queueMicrotask(() => {
            let event: CredentialEvent;
            switch (message.request.action) {
              case 'status':
              case 'accounts':
                event = state.denied
                  ? { type: 'error', message: 'Synthetic Keychain denial' }
                  : { type: 'result', accounts: [], apiConnected: state.connected };
                break;
              case 'api-key-save':
                if (state.denied) event = { type: 'error', message: 'Synthetic Keychain denial' };
                else {
                  state.connected = true;
                  event = { type: 'result', apiConnected: true };
                }
                break;
              case 'api-key-status':
                event = {
                  type: 'result',
                  apiConnected: state.connected,
                };
                break;
              case 'connection-status':
                event = {
                  type: 'result',
                  connection: {
                    connected: state.connected,
                    endpoint: 'https://api.openai.com/v1',
                  },
                };
                break;
              case 'connection-catalog':
                event = {
                  type: 'result',
                  catalog: {
                    fetchedAt: Date.now() / 1000,
                    models: [
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
                break;
              case 'api-key-remove':
                state.connected = false;
                event = { type: 'result', apiConnected: false };
                break;
              default:
                event = { type: 'error', message: 'Unexpected fixture operation' };
            }
            listeners.forEach((fn) => fn({ id: message.id, event }));
          });
        },
      } as unknown as chrome.runtime.Port;
    }) as typeof chrome.runtime.connectNative;
  }, DEFAULT_CONFIGURATION);
  await popup.reload();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(popup, 'Presets');
  await popup.getByRole('button', { name: 'Inspect custom', exact: true }).click();
  await settingsSection(popup, 'Preferences');
  if (!(await popup.getByRole('button', { name: 'Connect to Saul', exact: true }).isVisible()))
    await popup.getByText('Integrations', { exact: true }).click();
  await popup.getByRole('button', { name: 'Connect to Saul', exact: true }).click();
  await expect(
    popup.getByRole('alert').filter({ hasText: 'Synthetic Keychain denial' }),
  ).toBeVisible();
  const state = () =>
    worker.evaluate(async () => {
      const values = await chrome.storage.local.get([
        'saul_user_settings',
        'saul_user_settings_recovery_backup',
      ]);
      return values as {
        saul_user_settings: Configuration;
        saul_user_settings_recovery_backup: Configuration;
      };
    });
  expect((await state()).saul_user_settings.openaiCompatible.apiKey).toBe('fixture-official-key');
  await worker.evaluate(() => {
    (globalThis as unknown as { credentialFixture: { denied: boolean } }).credentialFixture.denied =
      false;
  });
  await popup.getByRole('button', { name: 'Reload saved settings', exact: true }).click();
  await settingsSection(popup, 'Presets');
  await popup.getByRole('button', { name: 'Inspect custom', exact: true }).click();
  await settingsSection(popup, 'Preferences');
  if (!(await popup.getByRole('button', { name: 'Connect to Saul', exact: true }).isVisible()))
    await popup.getByText('Integrations', { exact: true }).click();
  await popup.getByRole('button', { name: 'Connect to Saul', exact: true }).click();
  await expect(popup.getByText('OpenAI API key required', { exact: true })).toBeVisible();
  const adopted = await state();
  await expect(popup.getByRole('alert').filter({ hasText: 'helper disconnected' })).toHaveCount(0);
  expect(adopted.saul_user_settings.sharedCredentials).toBe('saul');
  expect(adopted.saul_user_settings.openaiCompatible.apiKey).toBe('fixture-official-key');
  expect(adopted.saul_user_settings.activeProfileId).toBe('official');
  expect(adopted.saul_user_settings.openaiCompatible.baseUrl).toBe('https://api.openai.com/v1');
  await settingsSection(popup, 'Presets');
  await expect(popup.getByLabel('Preset', { exact: true })).toHaveValue('inspect-custom');
  expect(adopted.saul_user_settings.profiles!.find((p) => p.id === 'custom')!.config.apiKey).toBe(
    'fixture-custom-key',
  );
  expect(adopted.saul_user_settings_recovery_backup.openaiCompatible.apiKey).toBe(
    'fixture-official-key',
  );
  await popup.setViewportSize({ width: 640, height: 720 });
  await settingsSection(popup, 'Connections');
  const api = popup.getByRole('article', { name: 'OpenAI API', exact: true });
  await expect(api.locator('.connection-capabilities code')).toHaveText(['Write', 'Draw', 'Speak']);
  await expect(api.getByText(/sk-\*\*\*/)).toHaveCount(0);
  await expect(popup.getByLabel('Connection name')).toHaveCount(0);
  await expect(api.getByRole('button', { name: 'Set up', exact: true })).toBeVisible();
  await expect(api.getByRole('status')).toHaveText('Not set up');
  await popup.screenshot({ path: info.outputPath('shared-credentials.png') });
  await settingsSection(popup, 'Preferences');
  await popup.getByRole('button', { name: 'Disconnect app', exact: true }).click();
  await expect(popup.getByRole('button', { name: 'Connect to Saul', exact: true })).toBeVisible();
  expect((await state()).saul_user_settings.sharedCredentials).toBe('disconnected');
  const requests = await worker.evaluate(
    () =>
      (globalThis as unknown as { credentialFixture: { requests: CredentialRequest[] } })
        .credentialFixture.requests,
  );
  expect(requests.some((r) => r.action === 'api-key-remove' || r.action === 'logout')).toBe(false);
  expect(
    requests.some((r) => r.action === 'api-key-save' || r.action === 'connection-key-save'),
  ).toBe(false);
});
