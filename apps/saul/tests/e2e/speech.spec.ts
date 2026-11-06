import { getHistory, settingsSection } from './driver.ts';
import { reviewScreenshots } from './artifacts.ts';
import { test, expect } from './fixtures.ts';
import { DEFAULT_SETTINGS } from '../../src/storage/settings';

test('Speak preview uses its saved API preset, stops on navigation and retains no audio history', async ({
  sandbox,
}, info) => {
  const { worker, popup } = await sandbox.launch();
  await popup.route('https://api.openai.com/v1/models', (route) =>
    route.fulfill({ json: { data: [{ id: 'gpt-realtime-2.1-mini' }] } }),
  );
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.configuration!.presets.push({
    id: 'speech-preset',
    name: 'Voice preview',
    provider: 'openai-compatible',
    connectionKey: 'openai-api',
    capability: 'speak',
    model: 'gpt-realtime-2.1-mini',
    speechOptions: { voice: 'marin' },
    profileId: 'official',
  });
  settings.profiles = [
    {
      id: 'official',
      name: 'Speech API',
      config: { ...settings.openaiCompatible, apiKey: 'fixture-key' },
    },
  ];
  settings.connectionProfiles = { 'openai-api': 'official' };
  await worker.evaluate(async (settings) => {
    await chrome.storage.local.set({ saul_user_settings: settings });
    const fixture = { mode: 'hold', tokenRequests: 0, requests: [] as unknown[], closed: 0 };
    Object.assign(globalThis, { speechFixture: fixture });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, options) => {
      if (String(url) !== 'https://api.openai.com/v1/realtime/client_secrets')
        return originalFetch(url, options);
      fixture.tokenRequests++;
      if (fixture.mode === 'error')
        return Response.json({ error: { message: 'fixture-key' } }, { status: 401 });
      return Response.json({ value: 'ek_fixture' });
    }) as typeof fetch;
    class Socket extends EventTarget {
      constructor(_url: string, _protocols: string[]) {
        super();
        queueMicrotask(() => this.emit({ type: 'session.created' }));
      }
      emit(data: unknown) {
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
      }
      send(data: string) {
        fixture.requests.push(JSON.parse(data));
        if (fixture.mode === 'audio')
          queueMicrotask(() => {
            // 100 ms of PCM silence, packaged by the production WAV owner.
            this.emit({ type: 'response.output_audio.delta', delta: btoa('\0'.repeat(4800)) });
            this.emit({ type: 'response.done', response: { status: 'completed' } });
          });
      }
      close() {
        fixture.closed++;
      }
    }
    globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  }, settings);
  await popup.setViewportSize({ width: 390, height: 850 });
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(popup, 'Presets');
  await popup.getByLabel('Preset', { exact: true }).selectOption('speech-preset');
  const widget = popup.getByRole('region', { name: 'Speech preview' });
  const generate = widget.getByRole('button', { name: 'Generate speech', exact: true });
  await expect(generate).toBeEnabled();
  await widget.getByLabel('Speech text').fill(' ');
  await expect(generate).toBeDisabled();
  await widget.getByLabel('Speech text').fill('Hello from a disposable fixture.');
  await generate.click();
  await expect(widget.getByRole('status')).toHaveText('Generating speech…');
  await expect(popup.getByLabel('Speech voice')).toBeDisabled();
  await widget.getByRole('button', { name: 'Stop speech request' }).click();
  await expect(widget.getByRole('status')).toHaveText('Stopped.');
  await expect
    .poll(() =>
      worker.evaluate(
        () => (globalThis as unknown as { speechFixture: { closed: number } }).speechFixture.closed,
      ),
    )
    .toBe(1);
  await generate.click();
  await expect(widget.getByRole('status')).toHaveText('Generating speech…');
  await settingsSection(popup, 'Preferences');
  await expect
    .poll(() =>
      worker.evaluate(
        () => (globalThis as unknown as { speechFixture: { closed: number } }).speechFixture.closed,
      ),
    )
    .toBe(2);
  await settingsSection(popup, 'Presets');
  await expect(widget.getByLabel('Speech text')).toHaveValue(
    'Hello from Saul. This is a speech preview.',
  );
  await worker.evaluate(() => {
    (globalThis as unknown as { speechFixture: { mode: string } }).speechFixture.mode = 'audio';
  });
  await generate.click();
  await expect(widget.getByRole('status')).toHaveText('Speech ready. Press Play to listen.');
  await expect(widget.locator('audio')).toHaveAttribute('src', /^blob:/);
  const audio = await widget.locator('audio').evaluate(async (el: HTMLAudioElement) => {
    const response = await fetch(el.src);
    return {
      type: response.headers.get('content-type'),
      bytes: (await response.arrayBuffer()).byteLength,
    };
  });
  expect(audio).toEqual({ type: 'audio/wav', bytes: 4844 });
  for (const width of [360, 1000])
    for (const colorScheme of ['light', 'dark'] as const) {
      await popup.setViewportSize({ width, height: 900 });
      await popup.emulateMedia({ colorScheme });
      await widget.scrollIntoViewIfNeeded();
      expect(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (reviewScreenshots)
        await popup.screenshot({
          path: info.outputPath(`speech-${width}-${colorScheme}.png`),
          fullPage: true,
        });
    }
  await worker.evaluate(() => {
    (globalThis as unknown as { speechFixture: { mode: string } }).speechFixture.mode = 'error';
  });
  await generate.click();
  await expect(widget.getByRole('alert')).toContainText('HTTP 401');
  await expect(widget.getByRole('alert')).not.toContainText('fixture-key');
  await expect(widget.locator('audio')).toHaveCount(0);
  await popup.getByLabel('Speech voice').selectOption('cedar');
  await expect(generate).toBeDisabled();
  await expect(widget.getByText('Save changes before generating speech.')).toBeVisible();
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(popup.getByText('Saved', { exact: true })).toBeVisible();
  await expect(generate).toBeEnabled();
  await popup.reload();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(popup, 'Presets');
  await popup.setViewportSize({ width: 390, height: 850 });
  await popup.getByLabel('Preset', { exact: true }).selectOption('speech-preset');
  await expect(popup.getByLabel('Speech voice')).toHaveValue('cedar');
  await expect(widget.locator('audio')).toHaveCount(0);
  expect(await getHistory(popup)).toHaveLength(0);
});

test('creates a Speak preset through its editor and keeps API setup in Connections', async ({
  sandbox,
}, info) => {
  const { popup } = await sandbox.launch();
  await popup.route('https://api.openai.com/v1/models', (route) =>
    route.fulfill({ json: { data: [{ id: 'gpt-realtime-2.1-mini' }] } }),
  );
  await popup.evaluate(async (defaults) => {
    const settings = structuredClone(defaults);
    settings.openaiCompatible.apiKey = 'fixture-no-network';
    await chrome.storage.local.set({ saul_user_settings: settings });
  }, DEFAULT_SETTINGS);
  await popup.setViewportSize({ width: 390, height: 850 });
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(popup, 'Presets');
  await popup.getByRole('button', { name: 'Add preset', exact: true }).click();
  await popup.getByLabel('Preset name', { exact: true }).fill('Narration');
  await popup.getByLabel('Connection', { exact: true }).selectOption('openai-api');
  await popup.getByLabel('Capability', { exact: true }).selectOption('speak');
  await expect(
    popup.getByLabel('Speech model').locator('option[value="gpt-realtime-2.1-mini"]'),
  ).toHaveCount(1);
  await popup.getByLabel('Speech model').selectOption('gpt-realtime-2.1-mini');
  await expect(popup.getByLabel('Speech model')).toHaveValue('gpt-realtime-2.1-mini');
  await popup.getByLabel('Speech voice').selectOption('cedar');
  await expect(popup.getByLabel('API key', { exact: true })).toBeHidden();
  await settingsSection(popup, 'Connections');
  await popup.getByLabel('Edit connection', { exact: true }).selectOption('openai-api');
  await popup.getByLabel('API key', { exact: true }).fill('fixture-only-no-network');
  await expect(popup.getByLabel('Speech model')).toBeHidden();
  for (const minimum of [true, false]) {
    await settingsSection(popup, 'Preferences');
    await popup.getByRole('checkbox', { name: /Min Mode/ }).setChecked(minimum);
    await settingsSection(popup, 'Connections');
    for (const width of [390, 1100])
      for (const colorScheme of ['light', 'dark'] as const) {
        await popup.setViewportSize({ width, height: 1350 });
        await popup.emulateMedia({ colorScheme });
        expect(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        if (reviewScreenshots)
          await popup.screenshot({
            path: info.outputPath(`provider-api-${minimum}-${width}-${colorScheme}.png`),
            fullPage: false,
          });
      }
  }
  await settingsSection(popup, 'Presets');
  await expect(popup.getByLabel('Speech voice')).toHaveValue('cedar');
  await expect(popup.getByLabel('Speech model')).toHaveValue('gpt-realtime-2.1-mini');
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(popup.getByText('Saved', { exact: true })).toBeVisible();
  await popup.reload();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(popup, 'Presets');
  await popup.setViewportSize({ width: 390, height: 850 });
  await popup.getByLabel('Preset', { exact: true }).selectOption({ label: 'Narration' });
  await expect(popup.getByLabel('Speech voice')).toHaveValue('cedar');
});
