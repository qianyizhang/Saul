import { afterEach, expect, it, vi } from 'vitest';
import { initSpeechBridge } from '../src/speech/bridge';
import { DEFAULT_SETTINGS } from '../src/storage/settings';

const request = {
  presetId: 'speak',
  providerKey: 'openai-api',
  model: 'gpt-realtime-2.1-mini',
  voice: 'marin',
  input: 'Hello.',
};
function harness() {
  let accept = (_port: chrome.runtime.Port) => {};
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'extension',
      getURL: (path: string) => `chrome-extension://extension/${path}`,
      onConnect: {
        addListener: (fn: typeof accept) => {
          accept = fn;
        },
      },
    },
  });
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.profiles = [
    {
      id: 'official',
      name: 'API',
      config: { ...settings.openaiCompatible, apiKey: 'fixture-key' },
    },
  ];
  settings.providerConnections = { 'openai-api': 'official' };
  settings.configuration!.presets.push({
    id: 'speak',
    name: 'Speak',
    providerKey: 'openai-api',
    provider: 'openai-compatible',
    capability: 'speak',
    model: request.model,
    speechOptions: { voice: 'marin' },
  });
  const load = vi.fn(async () => settings);
  initSpeechBridge(load);
  function connect(url: string) {
    let receive = (_value: unknown) => {},
      disconnect = () => {};
    const port = {
      name: 'saul-speech',
      sender: { id: 'extension', url },
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      onMessage: {
        addListener: (fn: typeof receive) => {
          receive = fn;
        },
      },
      onDisconnect: {
        addListener: (fn: typeof disconnect) => {
          disconnect = fn;
        },
      },
    };
    accept(port as unknown as chrome.runtime.Port);
    return { port, receive, disconnect };
  }
  return { load, connect };
}
afterEach(() => vi.unstubAllGlobals());
it('rejects content, offscreen and foreign senders before reading credentials', () => {
  const h = harness();
  for (const url of [
    'https://example.com',
    'chrome-extension://extension/offscreen.html',
    'chrome-extension://other/library.html',
  ])
    expect(h.connect(url).port.disconnect).toHaveBeenCalled();
  expect(h.load).not.toHaveBeenCalled();
});
it('validates requests before reading settings and starts only one operation per port', async () => {
  const h = harness(),
    ui = h.connect('chrome-extension://extension/popup.html');
  ui.receive({ ...request, apiKey: 'injected' });
  await vi.waitFor(() =>
    expect(ui.port.postMessage).toHaveBeenCalledWith({
      error: expect.stringContaining('Speech needs'),
    }),
  );
  ui.receive(request);
  expect(h.load).not.toHaveBeenCalled();
});
it('cancels token acquisition on caller loss and never forwards an API key in a reply', async () => {
  const h = harness(),
    ui = h.connect('chrome-extension://extension/library.html');
  const fetcher = vi.fn<typeof fetch>(
    (_url, options) =>
      new Promise((_resolve, reject) =>
        options!.signal!.addEventListener('abort', () =>
          reject(new DOMException('Stopped', 'AbortError')),
        ),
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  ui.receive(request);
  ui.receive(request);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(h.load).toHaveBeenCalledTimes(1);
  ui.disconnect();
  await vi.waitFor(() => expect(ui.port.disconnect).toHaveBeenCalled());
  expect(ui.port.postMessage).not.toHaveBeenCalled();
});

it('ends at its deadline even if reading saved configuration never replies', async () => {
  vi.useFakeTimers();
  try {
    const h = harness(),
      ui = h.connect('chrome-extension://extension/library.html');
    h.load.mockImplementation(() => new Promise<typeof DEFAULT_SETTINGS>(() => {}));
    ui.receive(request);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(ui.port.postMessage).toHaveBeenCalledWith({
      error: 'Speech timed out. Generate again to retry.',
    });
    expect(ui.port.disconnect).toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
