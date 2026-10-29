import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ActionManager } from '../src/actions/manager';
import { actionHost } from '../src/actions/host';
import { ACTION_STATE_KEY, type ActionState } from '../src/actions/contract';
import { ActionStore } from '../.build/native/action-store.mjs';
import { ActionRuntime } from '../.build/native/action-runtime.mjs';
import type { DbCall, RunInput } from '../src/types/storage';
import type { ModelEvent } from '../src/models/events';
import { prepareActionPreset } from '../src/actions/configuration';
import { DEFAULT_SETTINGS } from '../src/storage/settings';
import { starterConfiguration } from '../src/models/configuration';
import { prepareFrozenRun } from '../src/reading/configuration';

vi.mock('../src/actions/host', () => ({ actionHost: vi.fn() }));
let saved: ActionState;
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
const db = vi.fn(async () => ['a'.repeat(64)]) as unknown as DbCall;
beforeEach(async () => {
  vi.clearAllMocks();
  saved = {};
  root = await mkdtemp(join(tmpdir(), 'saul-action-manager-'));
  store = new ActionStore(join(root, 'revisions'));
  runtime = new ActionRuntime(store);
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async () => ({ [ACTION_STATE_KEY]: structuredClone(saved) })),
        set: vi.fn(async (v: Record<string, ActionState>) => {
          saved = structuredClone(v[ACTION_STATE_KEY]!);
        }),
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
async function settle(manager: ActionManager) {
  await vi.waitFor(async () =>
    expect((await manager.request({ action: 'status' })).building).toBe(false),
  );
  return manager.request({ action: 'status' });
}
it('creates, checks, previews, explicitly loads and revises without invoking the handler', async () => {
  const generate = vi.fn(async function* (): AsyncGenerator<ModelEvent> {
    yield { type: 'delta', text: JSON.stringify(module) };
    yield { type: 'complete' };
  });
  const manager = new ActionManager(db, generate);
  await manager.request(
    { action: 'build', prompt: 'Make a summary', presetId: 'builder' },
    { input, credential: '' },
  );
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
  await manager.request(
    { action: 'build', prompt: 'Make it shorter', presetId: 'builder' },
    { input, credential: '' },
  );
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
  const manager = new ActionManager(db, generate);
  await manager.request(
    { action: 'build', prompt: 'Create', presetId: 'builder' },
    { input, credential: '' },
  );
  let state = await settle(manager);
  expect(state.raw).toBe(response);
  expect(state.error).toContain('completed');
  expect(vi.mocked(actionHost).mock.calls.every(([r]) => r.action === 'prune')).toBe(true);
  complete = true;
  response = '{bad JSON';
  await manager.request(
    { action: 'build', prompt: 'Revise', presetId: 'builder' },
    { input, credential: '' },
  );
  state = await settle(manager);
  expect(state.raw).toBe(response);
  expect(state.candidate).toBeUndefined();
  expect(generate).toHaveBeenCalledTimes(2);
});
it('failed initialization and stale candidates preserve the selected action; rollback and built-in are explicit', async () => {
  const manager = new ActionManager(db);
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
  const manager = new ActionManager(db);
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

it('a failed initial builder save preserves idle state and never starts inference', async () => {
  const generate = vi.fn();
  const manager = new ActionManager(db, generate);
  await manager.ready;
  vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('disk full'));
  const failed = await manager.request(
    { action: 'build', prompt: 'Keep my request', presetId: 'builder' },
    { input, credential: '' },
  );
  expect(failed.error).toContain('disk full');
  expect(failed.prompt).toBe('Keep my request');
  expect(failed.building).not.toBe(true);
  expect((await manager.request({ action: 'status' })).building).not.toBe(true);
  expect(generate).not.toHaveBeenCalled();
});
it('reconciles an interrupted builder without resending and cancels explicit creation', async () => {
  saved = { building: true, raw: 'partial candidate' };
  const generate = vi.fn(async function* (
    _input: RunInput,
    _credential: string,
    signal?: AbortSignal,
  ): AsyncGenerator<ModelEvent> {
    yield { type: 'delta', text: 'partial' };
    await new Promise<void>((resolve) =>
      signal!.addEventListener('abort', () => resolve(), { once: true }),
    );
    signal!.throwIfAborted();
  });
  const manager = new ActionManager(db, generate);
  expect((await manager.request({ action: 'status' })).error).toContain('interrupted');
  expect(generate).not.toHaveBeenCalled();
  await manager.request(
    { action: 'build', prompt: 'Try now', presetId: 'builder' },
    { input, credential: '' },
  );
  await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
  const stopped = await manager.request({ action: 'stop' });
  expect(stopped.building).toBe(false);
  expect(stopped.raw).toBe('partial');
  expect(stopped.error).toContain('incomplete');
});

it('blocks creation before spending quota when the optional action helper is unavailable', async () => {
  vi.mocked(actionHost).mockRejectedValue(new Error('Action helper unavailable'));
  const generate = vi.fn();
  const manager = new ActionManager(db, generate);
  const result = await manager.request(
    { action: 'build', prompt: 'Keep this request', presetId: 'builder' },
    { input, credential: '' },
  );
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
  const manager = new ActionManager(db, generate);
  await manager.request(
    { action: 'build', prompt: 'Create', presetId: 'builder' },
    { input, credential: '' },
  );
  const state = await settle(manager);
  expect(state.raw).toHaveLength(100_000);
  expect(state.error).toContain('output limit');
  expect(saved.error).toContain('output limit');
  expect(state.candidate).toBeUndefined();
});

it('freezes preset choices, excludes credentials from saved input and blocks changed connection origins', () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.openaiCompatible = {
    baseUrl: 'https://provider.example/v1',
    model: 'chosen',
    apiKey: 'PRIVATE-FIXTURE-KEY',
    temperature: 0.6,
  };
  settings.configuration = starterConfiguration(settings);
  const prepared = prepareActionPreset(settings, 'preset-current');
  expect(prepared.credential).toBe('PRIVATE-FIXTURE-KEY');
  expect(JSON.stringify(prepared.input)).not.toContain('PRIVATE-FIXTURE-KEY');
  settings.configuration.presets[0]!.model = 'new-model';
  expect(prepareFrozenRun(settings, prepared.input).input.remote.model).toBe('chosen');
  settings.openaiCompatible.baseUrl = 'https://other.example/v1';
  expect(() => prepareFrozenRun(settings, prepared.input)).toThrow('endpoint has changed');
  expect(() => prepareActionPreset(settings, 'missing')).toThrow('existing saved preset');
});
