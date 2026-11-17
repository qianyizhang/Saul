import { describe, expect, it, vi } from 'vitest';
import {
  createCallExecutor,
  type CallExecutor,
  type CallSnapshot,
  type FrozenCall,
} from '../src/calls/execution';
import type { actionHost } from '../src/calls/host';
import type { streamModel } from '../src/providers/stream';
import type { ModelEvent } from '../src/providers/events';
type TextEvent = Extract<ModelEvent, { type: 'delta' | 'complete' }>;
import type { RunInput } from '../src/types/storage';

const pair = { en: 'A concrete explanation.', zh: '具体解释。' };
const summary = {
  lead: pair,
  points: [pair, pair],
  caution: null,
  flow: [],
  terms: [],
  question: null,
};
const raw = JSON.stringify(summary);
const input: RunInput = {
  provider: 'chatgpt-plan',
  plan: { accountId: 'frozen-account', model: 'frozen-model', effort: 'low' },
  remote: { baseUrl: '', model: '', temperature: 0.3 },
  local: { topK: 3, temperature: 0.3 },
  credentialOwner: 'saul',
  systemPrompt: '',
  userPrompt: '',
  context: { selection: '', pageTitle: '', pageUrl: '' },
};
const page = {
  title: 'Discussion',
  url: 'https://example.com/discussion',
  source: {
    text: 'Navigation\nThe discussion',
    coverage: 'Captured text',
    truncated: false,
    capturedAt: 1,
  },
};
const script: FrozenCall = { kind: 'script', revision: 'a'.repeat(64), input };
const options = () => ({
  credential: 'transient-key',
  signal: new AbortController().signal,
  onProgress: vi.fn<(output: CallSnapshot) => void>(),
});
async function* success(): AsyncGenerator<TextEvent> {
  yield { type: 'delta', text: raw };
  yield { type: 'complete' };
}

describe.each(['plan', 'preset'] as const)('%s Summarize execution', (route) => {
  const call: FrozenCall = {
    kind: 'summarize',
    instructions: 'Frozen instructions',
    model:
      route === 'preset'
        ? { kind: 'preset', input }
        : {
            kind: 'plan',
            accountId: 'frozen-account',
            model: 'frozen-model',
            effort: 'low',
            credentialOwner: 'saul',
          },
  };
  it('uses the frozen route, reports detached output and validates completion', async () => {
    const generate = vi.fn(success);
    const unused = vi.fn(success);
    const executor = createCallExecutor(
      route === 'plan' ? { plan: generate, model: unused } : { model: generate, plan: unused },
    );
    const progress = options();
    progress.onProgress.mockImplementation((snapshot) => {
      snapshot.raw = 'caller mutation';
    });
    const result = await executor.execute({ call, page }, progress);
    expect(result).toEqual({
      kind: 'completed',
      output: { raw },
      result: { kind: 'summary', summary },
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(unused).not.toHaveBeenCalled();
    expect(progress.onProgress).toHaveBeenCalled();
  });
  it.each([
    ['incomplete', 'execution'],
    ['provider', 'execution'],
    ['format', 'summary-format'],
    ['limit', 'execution'],
  ] as const)(
    'retains %s output and its failure classification without replay',
    async (mode, failure) => {
      const text = mode === 'limit' ? 'x'.repeat(30001) : 'partial';
      const generate = vi.fn(async function* (): AsyncGenerator<TextEvent> {
        yield { type: 'delta', text };
        if (mode === 'provider') throw new Error('Provider unavailable');
        if (mode === 'format') yield { type: 'complete' };
      });
      const executor = createCallExecutor({ plan: generate, model: generate });
      expect(await executor.execute({ call, page }, options())).toMatchObject({
        kind: 'failed',
        failure,
        output: { raw: text },
      });
      expect(generate).toHaveBeenCalledTimes(1);
    },
  );
  it('cancels with partial output and never reports late completion', async () => {
    let release!: () => void;
    const generate = vi.fn(async function* (): AsyncGenerator<TextEvent> {
      yield { type: 'delta', text: 'partial' };
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      yield { type: 'complete' };
    });
    const controller = new AbortController();
    const progress = { ...options(), signal: controller.signal };
    const execution = createCallExecutor({ plan: generate, model: generate }).execute(
      { call, page },
      progress,
    );
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    controller.abort();
    release();
    expect(await execution).toMatchObject({ kind: 'cancelled', output: { raw: 'partial' } });
    expect(progress.onProgress).toHaveBeenCalledTimes(1);
  });
  it('keeps PDF attachments and the existing provider-failure explanation', async () => {
    const pdfPage = {
      ...page,
      source: {
        kind: 'pdf-url' as const,
        attachment: { type: 'pdf-url' as const, url: 'https://example.com/file.pdf' },
        coverage: 'URL only',
        truncated: false,
        capturedAt: 1,
      },
    };
    const plan = vi.fn<typeof import('../src/providers/chatgpt-plan').planEvents>(
      async function* () {
        yield { type: 'delta', text: 'partial' };
        throw new Error('PDF unavailable');
      },
    );
    const model = vi.fn<typeof streamModel>(async function* () {
      yield { type: 'delta', text: 'partial' };
      throw new Error('PDF unavailable');
    });
    const result = await createCallExecutor({ plan, model }).execute(
      { call, page: pdfPage },
      options(),
    );
    expect(result).toMatchObject({
      kind: 'failed',
      failure: 'execution',
      message: expect.stringContaining('No local fallback was used.'),
    });
    if (route === 'plan')
      expect(plan.mock.calls[0]?.[0]).toMatchObject({ attachments: [pdfPage.source.attachment] });
    else expect(model.mock.calls[0]?.[3]).toEqual({ attachments: [pdfPage.source.attachment] });
  });
});

it('runs text cleanup and chained requests as one Call with frozen inputs and detached transcripts', async () => {
  let continueRun!: () => void;
  const original = structuredClone({ call: script, page });
  const before = structuredClone(original);
  const host = vi.fn<typeof actionHost>(async (request, opts) => {
    if (request.action !== 'run') throw new Error('Unexpected request');
    await new Promise<void>((resolve) => {
      continueRun = resolve;
    });
    opts!.progress!('Cleaning');
    const cleaned = request.source.text!.split('\n').slice(1).join('\n');
    const first = await opts!.generate!(
      { instructions: 'Summarize', input: cleaned },
      opts!.signal!,
    );
    const second = await opts!.generate!({ instructions: 'Critique', input: first }, opts!.signal!);
    return { type: 'result', text: second };
  });
  const model = vi.fn<typeof streamModel>(async function* (request) {
    yield { type: 'delta', text: request.userPrompt + ' response' };
    yield { type: 'complete' };
  });
  const progress = options();
  const seen: CallSnapshot[] = [];
  progress.onProgress.mockImplementation((snapshot) => {
    seen.push(structuredClone(snapshot));
    snapshot.raw = 'caller mutation';
    if (snapshot.calls?.[0]) snapshot.calls[0].output = 'caller mutation';
  });
  const run = createCallExecutor({ script: host, model }).execute(original, progress);
  original.page.source.text = 'Changed page';
  if (original.call.kind === 'script') original.call.input!.plan!.model = 'Changed model';
  continueRun();
  const outcome = await run;
  expect(outcome).toMatchObject({
    kind: 'completed',
    result: { kind: 'text', text: 'The discussion response response' },
    output: {
      raw: 'The discussion response\n\nThe discussion response response',
      calls: [
        {
          instructions: 'Summarize',
          input: 'The discussion',
          output: 'The discussion response',
          complete: true,
        },
        {
          instructions: 'Critique',
          input: 'The discussion response',
          output: 'The discussion response response',
          complete: true,
        },
      ],
    },
  });
  expect(outcome.output.progress).toBeUndefined();
  expect(model.mock.calls.every(([request]) => request.plan?.model === 'frozen-model')).toBe(true);
  expect(seen.find((snapshot) => snapshot.calls?.[0]?.output === '')?.calls?.[0]?.complete).toBe(
    false,
  );
  expect(host.mock.calls[0]?.[0]).toMatchObject({ source: { text: before.page.source.text } });
  expect(JSON.stringify(outcome)).not.toContain('transient-key');
});

it.each(['incomplete', 'oversized', 'empty-final', 'failed-after-generation'] as const)(
  'keeps custom %s output provisional without replay',
  async (mode) => {
    const text = mode === 'oversized' ? 'x'.repeat(60001) : 'partial';
    const model = vi.fn<typeof streamModel>(async function* () {
      yield { type: 'delta', text };
      if (mode !== 'incomplete') yield { type: 'complete' };
    });
    const host = vi.fn<typeof actionHost>(async (_request, opts) => {
      await opts!.generate!({ instructions: 'Process' }, opts!.signal!);
      if (mode === 'failed-after-generation') throw new Error('Script failed');
      return { type: 'result', text: '' };
    });
    const outcome = await createCallExecutor({ script: host, model }).execute(
      { call: script, page },
      options(),
    );
    expect(outcome).toMatchObject({ kind: 'failed', failure: 'execution', output: { raw: text } });
    expect(outcome).not.toHaveProperty('result');
    expect(model).toHaveBeenCalledTimes(1);
    expect(host).toHaveBeenCalledTimes(1);
  },
);

it('rejects an unavailable saved custom preset before invoking an adapter', async () => {
  const host = vi.fn<typeof actionHost>();
  const result = await createCallExecutor({ script: host }).execute(
    { call: { kind: 'script', revision: 'a'.repeat(64) }, page },
    options(),
  );
  expect(result).toMatchObject({
    kind: 'failed',
    message: expect.stringContaining('saved action preset'),
  });
  expect(host).not.toHaveBeenCalled();
});

it('cancels a custom chain and ignores callbacks retained after settlement', async () => {
  let callbacks: Parameters<typeof actionHost>[1];
  const host: typeof actionHost = async (_request, opts) => {
    callbacks = opts;
    await opts!.generate!({ instructions: 'First' }, opts!.signal!);
    return { type: 'result', text: 'Late final' };
  };
  const model: typeof streamModel = async function* (_input, _credential, signal) {
    yield { type: 'delta', text: 'partial' };
    await new Promise<void>((resolve) =>
      signal!.addEventListener('abort', () => resolve(), { once: true }),
    );
    signal!.throwIfAborted();
  };
  const controller = new AbortController();
  const progress = { ...options(), signal: controller.signal };
  const run = createCallExecutor({ script: host, model }).execute({ call: script, page }, progress);
  await vi.waitFor(() => expect(progress.onProgress.mock.calls.at(-1)?.[0].raw).toBe('partial'));
  controller.abort();
  expect(await run).toMatchObject({
    kind: 'cancelled',
    output: { raw: 'partial', calls: [{ complete: false }] },
  });
  progress.onProgress.mockClear();
  callbacks!.progress!('Too late');
  await expect(
    callbacks!.generate!({ instructions: 'Too late' }, new AbortController().signal),
  ).rejects.toThrow();
  expect(progress.onProgress).not.toHaveBeenCalled();
});

it('preserves PDF attachment with custom explicit input and allows a text-only script result', async () => {
  const request: Parameters<CallExecutor['execute']>[0] = {
    call: script,
    page: {
      ...page,
      source: {
        kind: 'pdf-url',
        attachment: { type: 'pdf-url', url: 'https://example.com/paper.pdf' },
        coverage: 'URL only',
        truncated: false,
        capturedAt: 1,
      },
    },
  };
  const model = vi.fn<typeof streamModel>(success);
  const host: typeof actionHost = async (_request, opts) => {
    await opts!.generate!({ instructions: 'Explain', input: 'Prepared input' }, opts!.signal!);
    return { type: 'result', text: 'Final text' };
  };
  expect(
    await createCallExecutor({ script: host, model }).execute(request, options()),
  ).toMatchObject({ kind: 'completed', result: { kind: 'text', text: 'Final text' } });
  expect(model.mock.calls[0]?.[0].userPrompt).toBe('Prepared input');
  expect(model.mock.calls[0]?.[3]).toEqual({
    attachments: [{ type: 'pdf-url', url: 'https://example.com/paper.pdf' }],
  });
  model.mockClear();
  const local: typeof actionHost = async () => ({ type: 'result', text: 'Locally prepared text' });
  expect(
    await createCallExecutor({ script: local, model }).execute({ call: script, page }, options()),
  ).toMatchObject({ kind: 'completed', result: { kind: 'text', text: 'Locally prepared text' } });
  expect(model).not.toHaveBeenCalled();
});
