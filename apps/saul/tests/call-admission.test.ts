import { expect, it, vi } from 'vitest';
import { createCallAdmission, retryCallCredential } from '../src/calls/admission';
import { DEFAULT_CONFIGURATION, type Configuration } from '../src/configuration/definition';
import { MISSING_CALL_BATCH, type DigestBatch } from '../shared/model/call-batch.ts';
function managed(): Configuration {
  return {
    ...structuredClone(DEFAULT_CONFIGURATION),
    sharedCredentials: 'saul' as const,
    chatgptPlan: { accountId: 'duplicate', model: 'other' },
    connections: [
      { key: 'gpt-plan', name: 'My plan', kind: 'chatgpt-plan' as const, accountId: 'bound' },
    ],
  };
}
it('validates the saved binding when retrying the original Summary route', async () => {
  const settings = managed();
  const saved: DigestBatch = {
    id: 'saved-summary',
    windowId: 1,
    windowTitle: 'Saved window',
    createdAt: 1,
    accountId: 'bound',
    credentialOwner: 'saul',
    connectionKey: 'gpt-plan',
    model: 'gpt-6-luna',
    effort: 'medium',
    prompt: 'Summarize',
    items: [],
  };
  const readSettings = vi.fn(async () => ({ state: 'ready' as const, settings, revision: '1' }));
  const retryCredential = () =>
    retryCallCredential(saved, async () => (await readSettings()).settings);
  await expect(retryCredential()).resolves.toBeUndefined();
  settings.connections = [];
  await expect(retryCredential()).rejects.toThrow('connection changed');

  // Never infer signed ownership from the current mode or a matching account label.
  delete saved.connectionKey;
  saved.credentialOwner = 'local';
  readSettings.mockClear();
  await expect(retryCredential()).rejects.toThrow('Select a new preset');
  delete saved.credentialOwner;
  await expect(retryCredential()).rejects.toThrow('Select a new preset');
  expect(readSettings).not.toHaveBeenCalled();
  // A signed original Summary can retry its exact old registration without finding a new binding.
  saved.credentialOwner = 'saul';
  await expect(retryCredential()).resolves.toBeUndefined();
  settings.sharedCredentials = 'disconnected';
  await expect(retryCredential()).rejects.toThrow('Integrations');
});

function admissionFixture() {
  const settings = managed();
  const preset = {
    ...settings.configuration!.presets[0]!,
    id: 'summary',
    name: 'Summary model',
    provider: 'chatgpt-plan' as const,
    connectionKey: 'gpt-plan',
    model: 'fixture',
    effort: 'low',
  };
  settings.configuration!.presets = [preset];
  let builtinPresetId: string | undefined;
  let url = 'https://example.test/original';
  let revision = '1';
  const readSettings = vi.fn(async () => ({
    state: 'ready' as const,
    revision,
    settings: structuredClone(settings),
  }));
  const checkModel = vi.fn(async () => {});
  const start = vi.fn(async (batch: DigestBatch) => batch);
  const lookup = vi.fn(
    async (): Promise<import('../shared/model/call-batch.ts').DigestResolution> => ({
      comparisons: [],
    }),
  );
  const saveChoices = vi.fn(async (_source: unknown, choices: { builtinPresetId?: string }) => {
    builtinPresetId = choices.builtinPresetId;
  });
  const launch = createCallAdmission({
    readSettings,
    checkModel,
    start,
    lookup,
    saveChoices,
    readBatch: vi.fn(async () => {
      throw new Error(MISSING_CALL_BATCH);
    }),
    readChoices: async () => ({
      source: { kind: 'shared', revision: 1 },
      state: 'ready',
      choices: { builtinPresetId },
    }),
    readSources: async () => ({
      windowTitle: 'Research',
      windowId: 2,
      items: [{ index: 0, tabId: 4, title: 'Page', url, status: 'queued', raw: '' }],
    }),
  });
  return {
    launch,
    start,
    lookup,
    checkModel,
    readSettings,
    saveChoices,
    choose: () => {
      builtinPresetId = preset.id;
    },
    navigate: () => {
      url = 'https://example.test/new';
    },
    changeRoute: () => {
      revision = '2';
      settings.connections[0]!.accountId = 'different';
    },
  };
}
const intent = { id: 'attempt', tabIds: [4] };
it('saves a first choice before starting and freezes the exact bound account', async () => {
  const f = admissionFixture();
  const setup = await f.launch(intent);
  if (setup.kind !== 'setup') throw new Error('Expected a choice');
  expect(setup.reason).toBe('choose');
  expect(f.start).not.toHaveBeenCalled();
  f.saveChoices.mockRejectedValueOnce(new Error('Save unconfirmed'));
  const approved = { ...intent, review: { stamp: setup.stamp, presetId: 'summary' } };
  await expect(f.launch(approved)).rejects.toThrow('Save unconfirmed');
  expect(f.start).not.toHaveBeenCalled();
  expect(await f.launch(approved)).toMatchObject({
    kind: 'started',
    batch: { summaryInput: { plan: { accountId: 'bound' }, preset: { id: 'summary' } } },
  });
  expect(f.start).toHaveBeenCalledTimes(1);
});
it.each(['source', 'route'])(
  'asks again if the %s changes while validating the model',
  async (change) => {
    const f = admissionFixture();
    f.choose();
    f.checkModel.mockImplementationOnce(async () => {
      if (change === 'source') f.navigate();
      else f.changeRoute();
    });
    const changed = await f.launch(intent);
    if (changed.kind !== 'setup') throw new Error('Expected review');
    expect(changed).toMatchObject({
      reason: 'changed',
      routeLabel: expect.stringContaining('My plan'),
      reviewSources: [
        {
          title: 'Page',
          url: change === 'source' ? 'https://example.test/new' : 'https://example.test/original',
        },
      ],
    });
    expect(f.start).not.toHaveBeenCalled();
    const accepted = await f.launch({ ...intent, review: { stamp: changed.stamp } });
    expect(accepted).toMatchObject({
      kind: 'started',
      batch: {
        summaryInput: { plan: { accountId: change === 'route' ? 'different' : 'bound' } },
        items: [
          {
            url: change === 'source' ? 'https://example.test/new' : 'https://example.test/original',
          },
        ],
      },
    });
  },
);
it('reopens a saved batch with unreadable provider settings without checking the provider', async () => {
  const f = admissionFixture();
  f.readSettings.mockRejectedValue(new Error('Disconnected'));
  f.lookup.mockResolvedValue({ batch: { id: 'saved' } as DigestBatch, comparisons: [] });
  expect(await f.launch(intent)).toMatchObject({ kind: 'reused', batch: { id: 'saved' } });
  expect(f.checkModel).not.toHaveBeenCalled();
  expect(f.start).not.toHaveBeenCalled();
});
