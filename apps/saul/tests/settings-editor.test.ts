import { expect, it, vi } from 'vitest';
import { createSettingsEditor } from '../src/settings/editor';
import { createConfigurationStore, SETTINGS_STORAGE_KEY } from '../src/configuration/store';
import { DEFAULT_CONFIGURATION } from '../src/configuration/definition';
import { SettingsDeliveryError } from '../src/configuration/client';
import type { SettingsRequest, SettingsState } from '../src/settings/contract';

function fixture(initial: unknown = DEFAULT_CONFIGURATION) {
  let values: Record<string, unknown> = { [SETTINGS_STORAGE_KEY]: structuredClone(initial) };
  const store = createConfigurationStore({
    read: async () => structuredClone(values[SETTINGS_STORAGE_KEY]),
    write: async (patch) => {
      values = { ...values, ...structuredClone(patch) };
    },
  });
  const request = vi.fn((request: SettingsRequest) => store(request));
  const editor = createSettingsEditor(request);
  return { editor, request, store, values: () => values };
}
const language = (value: string) => ({
  type: 'settings' as const,
  patch: { responseLanguage: value },
});

it('owns a clean edit/save lifecycle and preserves selection without making inspection dirty', async () => {
  const { editor, request } = fixture();
  const listener = vi.fn();
  editor.subscribe(listener);
  await editor.open();
  editor.edit({ type: 'select-recipe', id: 'recipe-lookup' });
  expect(editor.getSnapshot()).toMatchObject({
    phase: 'editing',
    dirty: false,
    selectedRecipeId: 'recipe-lookup',
  });
  editor.edit(language('Chinese'));
  expect(editor.getSnapshot().dirty).toBe(true);
  await editor.save();
  expect(editor.getSnapshot()).toMatchObject({
    dirty: false,
    saved: true,
    selectedRecipeId: 'recipe-lookup',
    configuration: { responseLanguage: 'Chinese' },
  });
  expect(request.mock.calls.map(([r]) => r.action)).toEqual(['read', 'commit']);
  expect(listener).toHaveBeenCalled();
});

it('keeps exposed views detached from the draft that will be saved', async () => {
  const { editor, values } = fixture();
  await editor.open();
  const snapshot = editor.getSnapshot();
  snapshot.configuration.connections[0]!.name = 'External mutation';
  snapshot.selectedPreset!.name = 'External preset mutation';
  editor.edit(language('Chinese'));
  await editor.save();
  expect(values()[SETTINGS_STORAGE_KEY]).toMatchObject({
    connections: DEFAULT_CONFIGURATION.connections,
    configuration: DEFAULT_CONFIGURATION.configuration,
    responseLanguage: 'Chinese',
  });
});

it('keeps inspected plan options across sections while account editing targets the standalone account', async () => {
  const configuration = structuredClone(DEFAULT_CONFIGURATION);
  configuration.chatgptPlan = { accountId: 'standalone', model: 'old-model', effort: 'low' };
  configuration.connections.push({
    key: 'bound',
    name: 'Bound',
    kind: 'chatgpt-plan',
    accountId: 'bound-account',
  });
  configuration.configuration!.presets[0] = {
    id: 'preset-current',
    name: 'Current',
    provider: 'chatgpt-plan',
    connectionKey: 'bound',
    model: 'selected-model',
    effort: 'high',
    fast: true,
  };
  const { editor } = fixture(configuration);
  await editor.open();
  expect(editor.getSnapshot().inspection.plan?.accountId).toBe('bound-account');
  expect(editor.getSnapshot().inspection.plan?.effort).toBe('high');
  editor.edit(language('Chinese'));
  await editor.save();
  expect(editor.getSnapshot().configuration.chatgptPlan).toEqual(configuration.chatgptPlan);
});
it('preserves a stale draft through failed/cancelled review and applies unrelated latest changes', async () => {
  const { editor, request, store } = fixture();
  await editor.open();
  editor.edit(language('Chinese'));
  const other = await store({ action: 'read' });
  if (other.state !== 'ready') throw new Error('Expected configuration');
  await store({
    action: 'commit',
    baseline: other.revision,
    settings: { ...other.settings, summaryPdfProcessing: 'local' },
  });
  await editor.save();
  expect(editor.getSnapshot()).toMatchObject({ blocked: true, dirty: true });
  request.mockRejectedValueOnce(new Error('Read failed'));
  await editor.reviewLatest();
  expect(editor.getSnapshot()).toMatchObject({
    blocked: true,
    dirty: true,
    error: expect.stringContaining('Your draft is still here'),
  });
  await editor.reviewLatest();
  editor.cancelReview();
  expect(editor.getSnapshot()).toMatchObject({ blocked: true, dirty: true, review: undefined });
  await editor.reviewLatest();
  editor.applyReview({});
  expect(editor.getSnapshot()).toMatchObject({
    blocked: false,
    dirty: true,
    configuration: { responseLanguage: 'Chinese', summaryPdfProcessing: 'local' },
  });
  await editor.save();
  expect(editor.getSnapshot()).toMatchObject({ dirty: false, saved: true });
});
it('never replays a lost commit reply; review of matching saved edits needs no second commit', async () => {
  const { editor, request, store } = fixture();
  await editor.open();
  editor.edit(language('Chinese'));
  request.mockImplementationOnce(async (r) => {
    await store(r);
    throw new SettingsDeliveryError(true);
  });
  await editor.save();
  await editor.save();
  expect(editor.getSnapshot()).toMatchObject({ blocked: true, dirty: true });
  expect(request.mock.calls.filter(([r]) => r.action === 'commit')).toHaveLength(1);
  await editor.reviewLatest();
  editor.applyReview({});
  expect(editor.getSnapshot()).toMatchObject({
    blocked: false,
    dirty: false,
    recoveryNotice: 'Your edits already match the saved settings.',
  });
  expect(request.mock.calls.filter(([r]) => r.action === 'commit')).toHaveLength(1);
});
it('locks the draft while conflict choices are open', async () => {
  const { editor, request } = fixture();
  await editor.open();
  editor.edit(language('Chinese'));
  request.mockResolvedValueOnce({ state: 'conflict', error: 'Changed elsewhere' });
  await editor.save();
  await editor.reviewLatest();
  expect(editor.getSnapshot().review).toBeDefined();
  // A returning connection/catalog operation can call edit despite the hidden form.
  editor.edit(language('English'));
  expect(editor.getSnapshot().configuration.responseLanguage).toBe('Chinese');
  editor.applyReview({});
  expect(editor.getSnapshot()).toMatchObject({
    dirty: true,
    configuration: { responseLanguage: 'Chinese' },
  });
});

it('blocks another connection commit after a server error with an uncertain write outcome', async () => {
  const { editor, request, store } = fixture();
  await editor.open();
  const connections = structuredClone(DEFAULT_CONFIGURATION.connections);
  connections[0]!.name = 'Renamed connection';
  request.mockImplementationOnce(async (r) => {
    await store(r);
    throw new Error('Shared configuration may already be saved; reload before saving again.');
  });
  await expect(
    editor.manageConnection({
      action: 'rename',
      key: connections[0]!.key,
      name: 'Renamed connection',
    }),
  ).rejects.toThrow('may already be saved');
  expect(editor.getSnapshot().blocked).toBe(true);
  await expect(
    editor.manageConnection({
      action: 'rename',
      key: connections[0]!.key,
      name: 'Renamed connection',
    }),
  ).rejects.toThrow('Save or reload');
  expect(request.mock.calls.filter(([r]) => r.action === 'commit')).toHaveLength(1);
  await editor.reload();
  expect(editor.getSnapshot()).toMatchObject({ blocked: false, configuration: { connections } });
});

it('requires a fresh read after a reset server error without replacing the recovery backup', async () => {
  const invalid = { providers: [] };
  const { editor, request, store, values } = fixture(invalid);
  await editor.open();
  request.mockImplementationOnce(async (r) => {
    await store(r);
    throw new Error('Could not back up and reset saved settings. Try again.');
  });
  await editor.resetInvalidSettings();
  expect(editor.getSnapshot().blocked).toBe(true);
  await editor.resetInvalidSettings();
  expect(request.mock.calls.filter(([r]) => r.action === 'reset')).toHaveLength(1);
  expect(values().saul_user_settings_recovery_backup).toEqual(invalid);
  await editor.reload();
  expect(editor.getSnapshot()).toMatchObject({ phase: 'editing', blocked: false });
});
it('locks edits during save and ignores the response after the session closes', async () => {
  const { editor, request } = fixture();
  await editor.open();
  editor.edit(language('Chinese'));
  let settle!: (s: SettingsState) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((r) => {
        settle = r;
      }),
  );
  const pending = editor.save();
  editor.edit(language('English'));
  expect(editor.getSnapshot()).toMatchObject({
    saving: true,
    configuration: { responseLanguage: 'Chinese' },
  });
  editor.close();
  const before = editor.getSnapshot();
  settle({ state: 'ready', revision: 'a'.repeat(64), settings: DEFAULT_CONFIGURATION });
  await pending;
  expect(editor.getSnapshot()).toBe(before);
});
it('ignores an old open response after reconnecting the same editor', async () => {
  const { editor, request } = fixture();
  let settle!: (s: SettingsState) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((r) => {
        settle = r;
      }),
  );
  const old = editor.open();
  editor.close();
  await editor.open();
  const before = editor.getSnapshot();
  settle({ state: 'invalid', revision: 'a'.repeat(64), error: 'Stale' });
  await old;
  expect(editor.getSnapshot()).toBe(before);
});
it('backs up an invalid record through the same store and blocks reset replay after uncertain delivery', async () => {
  const invalid = { providers: [] };
  const { editor, request, store, values } = fixture(invalid);
  await editor.open();
  expect(editor.getSnapshot()).toMatchObject({ phase: 'invalid', canResetInvalidSettings: true });
  request.mockImplementationOnce(async (r) => {
    await store(r);
    throw new SettingsDeliveryError(true);
  });
  await editor.resetInvalidSettings();
  await editor.resetInvalidSettings();
  expect(request.mock.calls.filter(([r]) => r.action === 'reset')).toHaveLength(1);
  expect(values().saul_user_settings_recovery_backup).toEqual(invalid);
  await editor.reload();
  expect(editor.getSnapshot()).toMatchObject({ phase: 'editing', blocked: false, dirty: false });
});
it('guards immediate connection commits while dirty and retains a failed local validation draft', async () => {
  const { editor, request } = fixture();
  await editor.open();
  editor.edit(language('Chinese'));
  await expect(editor.manageConnection({ action: 'delete', key: 'example' })).rejects.toThrow(
    'Save or reload',
  );
  editor.edit({ type: 'preset-name', name: '' });
  await editor.save();
  expect(editor.getSnapshot()).toMatchObject({ dirty: true, blocked: false, saved: false });
  expect(request.mock.calls).toHaveLength(1);
});
