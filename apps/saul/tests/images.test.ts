import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { generateImage, validateGeneratedImage } from '../src/models/images';
import { DEFAULT_SETTINGS } from '../src/storage/settings';
import { starterConfiguration } from '../src/models/configuration';
import { prepareRecipeRun, prepareFrozenRun } from '../src/reading/configuration';
import type { GeneratedImage } from '../src/models/images';
import { validateCredentialRequest } from '../native/credentials-contract.mts';

const gif = readFileSync(
  new URL('../../../contracts/fixtures/animation.gif', import.meta.url),
).toString('base64');
function prepared() {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.activeProfileId = 'api';
  settings.openaiCompatible = {
    baseUrl: 'https://api.openai.com/v1',
    model: 'text-model',
    temperature: 0.3,
    apiKey: 'fixture-key',
  };
  settings.profiles = [{ id: 'api', name: 'API', config: { ...settings.openaiCompatible } }];
  settings.configuration = starterConfiguration(settings);
  const preset = settings.configuration.presets.find((p) => p.capability === 'draw')!;
  preset.imageOptions!.outputFormat = 'gif';
  return {
    settings,
    ...prepareRecipeRun(
      settings,
      { selection: 'A waving tree', pageTitle: 'Trees', pageUrl: 'https://example.test' },
      'recipe-illustrate',
    ),
  };
}
afterEach(() => vi.unstubAllGlobals());
it('Illustrate freezes its Draw model, format and connection without storing credentials', () => {
  const { settings, input, credential } = prepared();
  expect(input.remote.model).toBe('gpt-image-2.6-flare');
  expect(input.recipe?.capability).toBe('draw');
  expect(input.preset?.imageOptions?.outputFormat).toBe('gif');
  expect(credential).toBe('fixture-key');
  expect(JSON.stringify(input)).not.toContain(credential);
  settings.configuration!.presets.find((p) => p.capability === 'draw')!.imageOptions!.outputFormat =
    'png';
  expect(prepareFrozenRun(settings, input).input.preset?.imageOptions?.outputFormat).toBe('gif');
});
it('sends one nonstreaming GIF request and returns the exact animation bytes', async () => {
  const { input } = prepared();
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: gif }] })));
  vi.stubGlobal('fetch', fetch);
  const close = vi.fn();
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 16, height: 16, close }));
  expect(await generateImage(input, 'fixture-key')).toEqual({ data: gif, mediaType: 'image/gif' });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
    model: 'gpt-image-2.6-flare',
    output_format: 'gif',
    n: 1,
  });
  expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty('stream');
  expect(close).toHaveBeenCalledOnce();
});
it('rejects old-model GIFs, wrong endpoints, malformed output and cancelled requests without retry', async () => {
  const { input } = prepared();
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const old = structuredClone(input);
  old.remote.model = 'gpt-image-2.5-flare';
  await expect(generateImage(old, 'fixture')).rejects.toThrow('GIF requires');
  const other = structuredClone(input);
  other.remote.baseUrl = 'https://other.test/v1';
  await expect(generateImage(other, 'fixture')).rejects.toThrow('official');
  const abort = new AbortController();
  abort.abort();
  await expect(generateImage(input, 'fixture', abort.signal)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  fetch.mockResolvedValue(
    new Response(JSON.stringify({ data: [{ b64_json: btoa('not a GIF') }] })),
  );
  await expect(generateImage(input, 'fixture')).rejects.toThrow('invalid');
  expect(fetch).toHaveBeenCalledTimes(1);
  for (const image of [
    { data: gif, mediaType: 'image/png' },
    { data: 'null', mediaType: 'image/gif' },
  ])
    expect(() => validateGeneratedImage(image as GeneratedImage)).toThrow();
  expect(() =>
    validateCredentialRequest({
      action: 'api-image',
      prompt: 'tree',
      model: 'gpt-image-2.6-flare',
      size: '1024x1024',
      quality: 'low',
      outputFormat: 'gif',
      imageBase64: gif,
    }),
  ).toThrow();
});
