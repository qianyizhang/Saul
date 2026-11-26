import { storagePort } from './helpers/storage-port';
import type { ModelRequest } from '../shared/model/execution-route.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CallEditor } from '../src/calls/editor';
import { createCustomActionStore } from '../src/custom-actions/store';
import type { streamModel } from '../src/providers/stream';
import { actionHost } from '../src/custom-actions/host-client';
import { LEGACY_CALL_STATE_KEY } from '../src/custom-actions/contract';
import type { CallEditorState } from '../src/calls/contract';
import { ActionStore } from '../.build/native/action-store.mjs';
import { ActionRuntime } from '../.build/native/action-runtime.mjs';
import type { DbCall, RunInput } from '../shared/protocol/history-types.ts';
import type { ModelEvent } from '../shared/model/model-events.ts';
import { DEFAULT_CONFIGURATION } from '../src/configuration/definition';
import { starterConfiguration } from '../src/configuration/definition';
import { prepareFrozenPreset, prepareWritePreset } from '../src/configuration/resolve';

vi.mock('../src/custom-actions/host-client', () => ({ actionHost: vi.fn() }));
let saved: CallEditorState;
let local: Record<string, unknown>;
function readLocal(keys: string | string[]) {
  return Object.fromEntries(
    (typeof keys === 'string' ? [keys] : keys).map((key) => [
      key,
      key === LEGACY_CALL_STATE_KEY ? saved : local[key],
    ]),
  );
}
function writeLocal(values: Record<string, unknown>) {
  Object.assign(local, structuredClone(values));
}
let root: string;
let store: ActionStore;
let runtime: ActionRuntime;
const module = {
  contractVersion: 1,
  name: 'Shorter',
  description: 'Plain answer',
  language: 'typescript',
  source: 'export default async ctx => "final";',
};
const input: RunInput = {
  provider: 'chatgpt-plan',
  remote: { baseUrl: '', model: '', temperature: 0.3 },
  local: { topK: 3, temperature: 0.3 },
  plan: { accountId: 'account', model: 'model', effort: 'low' },
  systemPrompt: '',
  userPrompt: '',
  context: { selection: '', pageTitle: '', pageUrl: '' },
};
function editor(generate?: typeof streamModel) {
  return new CallEditor({
    db,
    prepare: async () => ({ choices: input, credential: '' }),
    generate,
    storage: createCustomActionStore(),
  });
}
const db = vi.fn(async () => ['a'.repeat(64)]) as unknown as DbCall;
beforeEach(async () => {
  vi.clearAllMocks();
  saved = {};
  local = {};
  root = await mkdtemp(join(tmpdir(), 'saul-call-editor-'));
  store = new ActionStore(join(root, 'revisions'));
  runtime = new ActionRuntime(store);
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (keys) => structuredClone(readLocal(keys))),
        set: vi.fn(async (values) => writeLocal(values)),
      },
    },
  });
  vi.mocked(actionHost).mockImplementation(async (r) => {
    if (r.action === 'stage') return { type: 'result', revision: await store.stage(r.module) };
    if (r.action === 'load') return { type: 'result', revision: await runtime.load(r.revision) };
    if (r.action === 'prune') {
      await runtime.prune(r.protect);
      return { type: 'result' };
    }
    throw new Error('Unexpected helper request');
  });
});
afterEach(async () => {
  await runtime.close();
  await rm(root, { recursive: true, force: true });
  vi.unstubAllGlobals();
});
async function settle(manager: CallEditor) {
  await vi.waitFor(async () =>
    expect((await manager.request({ action: 'status' })).building).toBe(false),
  );
  return manager.request({ action: 'status' });
}

it('distinguishes a lost status read from a saved record that needs repair', async () => {
  const manager = editor();
  await manager.request({ action: 'status' });
  vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('Choice storage offline'));
  await expect(manager.request({ action: 'status' })).rejects.toThrow('Choice storage offline');
  await expect(manager.request({ action: 'status' })).resolves.toMatchObject({ building: false });

  const damaged = { selected: 7 };
  local.saul_call_choices_v1 = damaged;
  await expect(manager.request({ action: 'status' })).resolves.toMatchObject({
    blocked: true,
    building: false,
    error: 'Invalid action preset reference.',
  });
  expect(local.saul_call_choices_v1).toEqual(damaged);
});

it('creates, checks, previews, explicitly loads and revises without invoking the handler', async () => {
  const generate = vi.fn(async function* (): AsyncGenerator<ModelEvent> {
    yield { type: 'delta', text: JSON.stringify(module) };
    yield { type: 'complete' };
  });
  const manager = editor(generate);
  await manager.request({ action: 'build', prompt: 'Make a summary', presetId: 'builder' });
  const checked = await settle(manager);
  expect(checked.candidate?.approved).toBeUndefined();
  expect(checked.selected).toBeUndefined();
  expect(actionHost).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'run' }));
  const selected = await manager.request({
    action: 'load',
    revision: checked.candidate!.revision,
    presetId: 'runner',
  });
  expect(selected.selected?.presetId).toBe('runner');
  await manager.request({ action: 'build', prompt: 'Make it shorter', presetId: 'builder' });
  await settle(manager);
  const request = generate.mock.calls.at(-1) as unknown as [RunInput];
  expect(JSON.parse(request[0].userPrompt)).toMatchObject({
    request: 'Make it shorter',
    current: { source: module.source },
  });
  expect(generate).toHaveBeenCalledTimes(2);
  expect(
    vi
      .mocked(actionHost)
      .mock.calls.some(([r]) => r.action === 'prune' && r.protect.includes('a'.repeat(64))),
  ).toBe(true);
});
it('retains malformed, refused and incomplete output for the next explicit revision without repair calls', async () => {
  let response = 'I cannot provide that module';
  let complete = false;
  const generate = vi.fn(async function* (): AsyncGenerator<ModelEvent> {
    yield { type: 'delta', text: response };
    if (complete) yield { type: 'complete' };
  });
  const manager = editor(generate);
  await manager.request({ action: 'build', prompt: 'Create', presetId: 'builder' });
  let state = await settle(manager);
  expect(state.raw).toBe(response);
  expect(state.error).toContain('completed');
  expect(vi.mocked(actionHost).mock.calls.every(([r]) => r.action === 'prune')).toBe(true);
  complete = true;
  response = '{bad JSON';
  await manager.request({ action: 'build', prompt: 'Revise', presetId: 'builder' });
  state = await settle(manager);
  expect(state.raw).toBe(response);
  expect(state.candidate).toBeUndefined();
  expect(generate).toHaveBeenCalledTimes(2);
});
it('failed initialization and stale candidates preserve the selected action; rollback and built-in are explicit', async () => {
  const manager = editor();
  const first = await manager.request({ action: 'stage', json: JSON.stringify(module) });
  const original = (
    await manager.request({
      action: 'load',
      revision: first.candidate!.revision,
      presetId: 'preset',
    })
  ).selected;
  const invalid = await manager.request({
    action: 'stage',
    json: JSON.stringify({
      ...module,
      source: 'throw new Error("init failed"); export default () => "no";',
    }),
  });
  const failed = await manager.request({
    action: 'load',
    revision: invalid.candidate!.revision,
    presetId: 'preset',
  });
  expect(failed.error).toContain('init failed');
  expect(failed.selected).toEqual(original);
  const next = await manager.request({
    action: 'stage',
    json: JSON.stringify({ ...module, source: 'export default () => "new";' }),
  });
  expect(
    (
      await manager.request({
        action: 'load',
        revision: first.candidate!.revision,
        presetId: 'preset',
      })
    ).error,
  ).toContain('candidate changed');
  await manager.request({ action: 'load', revision: next.candidate!.revision, presetId: 'other' });
  expect((await manager.request({ action: 'restore' })).selected).toEqual(original);
  const calls = vi.mocked(actionHost).mock.calls.length;
  expect((await manager.request({ action: 'builtin' })).selected).toBeUndefined();
  expect(actionHost).toHaveBeenCalledTimes(calls);
});
it('does not adopt a loaded candidate when saving selection fails', async () => {
  const manager = editor();
  const checked = await manager.request({ action: 'stage', json: JSON.stringify(module) });
  vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('disk full'));
  const result = await manager.request({
    action: 'load',
    revision: checked.candidate!.revision,
    presetId: 'preset',
  });
  expect(result.selected).toBeUndefined();
  expect(result.error).toContain('disk full');
});

it('keeps an acknowledged shared Call selected even when Chrome cannot save a draft', async () => {
  let config: { revision: number; value: object } = {
    revision: 1,
    value: { schema: 2, library: [] },
  };
  const writes: object[] = [];
  local.saul_calls_unified = true;
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (keys: string | string[]) => readLocal(keys),
        set: async (values: Record<string, unknown>) => {
          if (writes.length) throw new Error('Chrome disk full');
          writeLocal(values);
        },
      },
    },
    runtime: {
      connectNative: storagePort(
        async (_host: string, { request }: { request: { action: string; value: object } }) => {
          if (request.action === 'config-save') {
            writes.push(request.value);
            config = { revision: config.revision + 1, value: request.value };
          }
          return { event: { type: 'result', config } };
        },
      ),
    },
  });
  const manager = editor();
  const { candidate } = await manager.request({ action: 'stage', json: JSON.stringify(module) });
  const selected = await manager.request({
    action: 'load',
    revision: candidate!.revision,
    presetId: 'preset',
  });
  expect(writes).toHaveLength(1);
  expect(selected.selected?.revision.revision).toBe(candidate!.revision);
  expect((await editor().request({ action: 'status' })).selected).toEqual(selected.selected);
});

it('a failed initial builder save preserves idle state and never starts inference', async () => {
  const generate = vi.fn();
  const manager = editor(generate);
  await manager.request({ action: 'status' });
  vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('disk full'));
  const failed = await manager.request({
    action: 'build',
    prompt: 'Keep my request',
    presetId: 'builder',
  });
  expect(failed.error).toContain('disk full');
  expect(failed.prompt).toBe('Keep my request');
  expect(failed.building).not.toBe(true);
  expect((await manager.request({ action: 'status' })).building).not.toBe(true);
  expect(generate).not.toHaveBeenCalled();
});
it('reconciles an interrupted builder without resending and cancels explicit creation', async () => {
  saved = { building: true, raw: 'partial candidate' };
  const generate = vi.fn(async function* (
    _input: ModelRequest,
    _credential: string,
    signal?: AbortSignal,
  ): AsyncGenerator<ModelEvent> {
    yield { type: 'delta', text: 'partial' };
    await new Promise<void>((resolve) =>
      signal!.addEventListener('abort', () => resolve(), { once: true }),
    );
    signal!.throwIfAborted();
  });
  const manager = editor(generate);
  expect((await manager.request({ action: 'status' })).error).toContain('interrupted');
  expect(generate).not.toHaveBeenCalled();
  await manager.request({ action: 'build', prompt: 'Try now', presetId: 'builder' });
  await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
  const stopped = await manager.request({ action: 'stop' });
  expect(stopped.building).toBe(false);
  expect(stopped.raw).toBe('partial');
  expect(stopped.error).toContain('incomplete');
});

it('blocks creation before spending quota when the optional action helper is unavailable', async () => {
  vi.mocked(actionHost).mockRejectedValue(new Error('Action helper unavailable'));
  const generate = vi.fn();
  const manager = editor(generate);
  const result = await manager.request({
    action: 'build',
    prompt: 'Keep this request',
    presetId: 'builder',
  });
  expect(result.error).toContain('unavailable');
  expect(result.prompt).toBe('Keep this request');
  expect(generate).not.toHaveBeenCalled();
  expect(result.building).not.toBe(true);
});

it('retains bounded oversized builder output with its real error instead of a false save failure', async () => {
  const generate = vi.fn(async function* (): AsyncGenerator<ModelEvent> {
    yield { type: 'delta', text: 'x'.repeat(100_001) };
    yield { type: 'complete' };
  });
  const manager = editor(generate);
  await manager.request({ action: 'build', prompt: 'Create', presetId: 'builder' });
  const state = await settle(manager);
  expect(state.raw).toHaveLength(100_000);
  expect(state.error).toContain('output limit');
  expect((await editor().request({ action: 'status' })).error).toContain('output limit');
  expect(state.candidate).toBeUndefined();
});

it('freezes preset choices, excludes credentials from saved input and blocks changed connection origins', () => {
  const settings = structuredClone(DEFAULT_CONFIGURATION);
  settings.openaiCompatible = {
    baseUrl: 'https://provider.example/v1',
    model: 'chosen',
    apiKey: 'PRIVATE-FIXTURE-KEY',
    temperature: 0.6,
  };
  settings.configuration = starterConfiguration(settings);
  const prepared = prepareWritePreset(settings, 'preset-current');
  expect(prepared.credential).toBe('PRIVATE-FIXTURE-KEY');
  expect(JSON.stringify(prepared.choices)).not.toContain('PRIVATE-FIXTURE-KEY');
  settings.configuration.presets[0]!.model = 'new-model';
  expect(prepareFrozenPreset(settings, prepared.choices).input.remote.model).toBe('chosen');
  settings.openaiCompatible.baseUrl = 'https://other.example/v1';
  expect(() => prepareFrozenPreset(settings, prepared.choices)).toThrow('Select a new preset');
  expect(() => prepareWritePreset(settings, 'missing')).toThrow('existing saved preset');
});

it('keeps every saved call preset selectable across restart and built-in selection', async () => {
  const manager = editor();
  const choices = [];
  for (let n = 0; n < 4; n++) {
    const checked = await manager.request({
      action: 'stage',
      json: JSON.stringify({
        ...module,
        name: `Call ${n}`,
        source: `export default () => "${n}";`,
      }),
    });
    const state = await manager.request({
      action: 'load',
      revision: checked.candidate!.revision,
      presetId: 'runner',
    });
    choices.push(state.selected!);
  }
  expect((await manager.request({ action: 'status' })).library).toHaveLength(4);
  await manager.request({ action: 'builtin' });
  const restarted = editor();
  expect((await restarted.request({ action: 'status' })).selected).toBeUndefined();
  const selected = await restarted.request({
    action: 'select',
    revision: choices[0]!.revision.revision,
    presetId: 'runner',
  });
  expect(selected.selected).toEqual(choices[0]);
  expect(selected.library).toHaveLength(4);
  const missing = await restarted.request({
    action: 'select',
    revision: 'f'.repeat(64),
    presetId: 'runner',
  });
  expect(missing.selected).toEqual(choices[0]);
  expect(missing.error).toBeTruthy();
  const prunes = vi.mocked(actionHost).mock.calls.filter(([r]) => r.action === 'prune');
  const last = prunes.at(-1)![0];
  if (last.action !== 'prune') throw new Error('Expected prune');
  for (const choice of choices) expect(last.protect).toContain(choice.revision.revision);
});

it('adopts both choices from the old Chrome record without letting it become a second authority', async () => {
  const original = await store.stage(module);
  const next = await store.stage({ ...module, source: 'export default async () => "next";' });
  const previous = { revision: await runtime.load(original.revision), presetId: 'previous' };
  const selected = { revision: await runtime.load(next.revision), presetId: 'selected' };
  saved = { selected, previous };
  expect(await editor().request({ action: 'status' })).toMatchObject({
    selected,
    previous,
    library: [previous, selected],
  });
  expect(saved).toEqual({ selected, previous });
  saved = { selected: previous };
  expect(await editor().request({ action: 'status' })).toMatchObject({
    selected,
    previous,
    library: [previous, selected],
  });
});

it('stores custom choices once and keeps the built-in model across custom selection and restore', async () => {
  const manager = editor();
  const initial = await manager.request({ action: 'status' });
  await manager.request({
    action: 'builtin-preset',
    presetId: 'summary',
    baseline: initial.choiceSource!,
  });
  const { candidate } = await manager.request({ action: 'stage', json: JSON.stringify(module) });
  const selected = await manager.request({
    action: 'load',
    revision: candidate!.revision,
    presetId: 'runner',
  });
  const key = `${candidate!.revision}:runner`;
  expect(local.saul_call_choices_v1).toMatchObject({
    value: {
      schema: 2,
      library: [selected.selected],
      selected: key,
      builtinPresetId: 'summary',
    },
  });
  await manager.request({ action: 'builtin' });
  expect(local.saul_call_choices_v1).toMatchObject({
    value: { library: [selected.selected], previous: key, builtinPresetId: 'summary' },
  });
  const restarted = editor();
  expect(await restarted.request({ action: 'status' })).toMatchObject({
    builtinPresetId: 'summary',
    previous: selected.selected,
  });
  expect(await restarted.request({ action: 'restore' })).toMatchObject({
    builtinPresetId: 'summary',
    selected: selected.selected,
  });
});

it('requires a fresh Settings selection revision after another surface changes the default', async () => {
  const manager = editor();
  const baseline = (await manager.request({ action: 'status' })).choiceSource!;
  const saved = await manager.request({ action: 'builtin-preset', presetId: 'first', baseline });
  expect(saved.builtinPresetId).toBe('first');
  expect(saved.choiceSource?.revision).toBeGreaterThan(baseline.revision);
  expect(
    await manager.request({ action: 'builtin-preset', presetId: 'stale', baseline }),
  ).toMatchObject({
    builtinPresetId: 'first',
    error: 'Saved Calls changed. Review the current selection.',
  });
});

it('blocks ordinary preset saves on damaged choices and recovers the readable library explicitly', async () => {
  const revision = await runtime.load((await store.stage(module)).revision);
  const retained = { revision, presetId: 'runner' };
  const damaged = {
    revision: 4,
    value: {
      schema: 2,
      library: [retained],
      previous: `${revision.revision}:runner`,
      selected: 'missing',
      builtinPresetId: 'summary',
    },
  };
  local.saul_call_choices_v1 = damaged;
  const manager = editor();
  const status = await manager.request({ action: 'status' });
  expect(status).toMatchObject({ blocked: true, canRecover: true });
  expect(
    await manager.request({
      action: 'builtin-preset',
      presetId: 'must-not-overwrite',
      baseline: status.choiceSource!,
    }),
  ).toMatchObject({ blocked: true });
  expect(local.saul_call_choices_v1).toEqual(damaged);
  expect(await manager.request({ action: 'builtin' })).toMatchObject({
    library: [retained],
    builtinPresetId: 'summary',
    previous: retained,
  });

  const future = { revision: 6, value: { schema: 3, library: [], newField: 'future-data' } };
  local.saul_call_choices_v1 = future;
  expect(await manager.request({ action: 'builtin' })).toMatchObject({
    blocked: true,
    canRecover: false,
  });
  expect(local.saul_call_choices_v1).toEqual(future);
});
