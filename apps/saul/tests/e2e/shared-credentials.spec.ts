import { test, expect } from './fixtures.ts';
import { settingsSection } from './driver.ts';
import type { CredentialRequest, CredentialEvent } from '../../native/credentials-contract.mts';
import type { UserSettings } from '../../src/types';
import { DEFAULT_SETTINGS } from '../../src/storage/settings';

test('shared credential adoption preserves denied sources, removes verified official copies and disconnects without fallback', async ({
  sandbox,
}, info) => {
  const { worker, popup } = await sandbox.launch();
  await worker.evaluate(async (defaults) => {
    const key = 'saul_user_settings';
    const saved = ((await chrome.storage.local.get(key))[key] as UserSettings) || defaults;
    const official = {
      ...saved.openaiCompatible,
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'fixture-official-key',
    };
    const settings: UserSettings = {
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
      providerConnections: { ...saved.providerConnections, 'openai-api': 'official' },
    };
    await chrome.storage.local.set({
      [key]: settings,
      saul_user_settings_recovery_backup: settings,
    });
    const original = chrome.runtime.connectNative.bind(chrome.runtime);
    const state = {
      denied: true,
      connected: false,
      cleanupDenied: true,
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
        postMessage: (message: { id: string; request: CredentialRequest }) => {
          state.requests.push(message.request);
          queueMicrotask(() => {
            let event: CredentialEvent;
            switch (message.request.action) {
              case 'status':
              case 'accounts':
                event = { type: 'result', accounts: [], apiConnected: state.connected };
                break;
              case 'api-key-import':
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
                  retired: !state.cleanupDenied,
                };
                break;
              case 'api-key-remove':
                state.connected = false;
                event = { type: 'result', apiConnected: false };
                break;
              case 'migration-verified':
                event = state.cleanupDenied
                  ? { type: 'error', message: 'Synthetic cleanup denial' }
                  : { type: 'result', retired: true };
                break;
              default:
                event = { type: 'error', message: 'Unexpected fixture operation' };
            }
            listeners.forEach((fn) => fn({ id: message.id, event }));
          });
        },
      } as unknown as chrome.runtime.Port;
    }) as typeof chrome.runtime.connectNative;
  }, DEFAULT_SETTINGS);
  await popup.reload();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(popup, 'Providers');
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
        saul_user_settings: UserSettings;
        saul_user_settings_recovery_backup: UserSettings;
      };
    });
  expect((await state()).saul_user_settings.openaiCompatible.apiKey).toBe('fixture-official-key');
  await worker.evaluate(() => {
    (globalThis as unknown as { credentialFixture: { denied: boolean } }).credentialFixture.denied =
      false;
  });
  await popup.getByRole('button', { name: 'Reload saved settings', exact: true }).click();
  await settingsSection(popup, 'Providers');
  await popup.getByRole('button', { name: 'Connect to Saul', exact: true }).click();
  await expect(popup.getByText('OpenAI API key saved', { exact: true })).toBeVisible();
  await expect(
    popup.getByText('Connected · old credential cleanup pending', { exact: true }),
  ).toBeVisible();
  await expect(
    popup.getByRole('alert').filter({ hasText: 'Synthetic cleanup denial' }),
  ).toHaveCount(0);
  await popup.getByRole('button', { name: 'Retry cleanup', exact: true }).click();
  await expect(
    popup.getByRole('alert').filter({ hasText: 'Synthetic cleanup denial' }),
  ).toBeVisible();
  await worker.evaluate(() => {
    (
      globalThis as unknown as { credentialFixture: { cleanupDenied: boolean } }
    ).credentialFixture.cleanupDenied = false;
  });
  await popup.getByRole('button', { name: 'Retry cleanup', exact: true }).click();
  await expect(popup.getByRole('button', { name: 'Retry cleanup', exact: true })).toHaveCount(0);
  const adopted = await state();
  await expect(popup.getByRole('alert').filter({ hasText: 'helper disconnected' })).toHaveCount(0);
  expect(adopted.saul_user_settings.sharedCredentials).toBe('saul');
  expect(adopted.saul_user_settings.openaiCompatible.apiKey).toBe('');
  expect(adopted.saul_user_settings.profiles!.find((p) => p.id === 'custom')!.config.apiKey).toBe(
    'fixture-custom-key',
  );
  expect(adopted.saul_user_settings_recovery_backup.openaiCompatible.apiKey).toBe('');
  await popup.setViewportSize({ width: 640, height: 720 });
  await popup.screenshot({ path: info.outputPath('shared-credentials.png') });
  await popup.getByRole('button', { name: 'Disconnect app', exact: true }).click();
  await expect(popup.getByRole('button', { name: 'Connect to Saul', exact: true })).toBeVisible();
  expect((await state()).saul_user_settings.sharedCredentials).toBe('disconnected');
  const requests = await worker.evaluate(
    () =>
      (globalThis as unknown as { credentialFixture: { requests: CredentialRequest[] } })
        .credentialFixture.requests,
  );
  expect(requests.some((r) => r.action === 'api-key-remove' || r.action === 'logout')).toBe(false);
  expect(requests.some((r) => r.action === 'migration-verified')).toBe(true);
});
