import { describe, it, expect, vi } from 'vitest';
import { parseSummary } from '../src/calls/execution/summary';
import { digestHtml } from '../src/calls/ui/summary-html';
import { validateCallControl, validateCallLaunch } from '../src/calls/batch-messages';
import { CallBatchRunner } from '../src/calls/execution/batch-runner';
import { createCallExecutor } from '../src/calls/execution/executor';
import type { actionHost } from '../src/custom-actions/host-client';
import {
  activeItem,
  interruptItem,
  restartItem,
  retryableItem,
  type DigestBatch,
  type DigestSource,
} from '../shared/model/call-batch.ts';
import type { DbCall, DbRequest } from '../shared/protocol/history-types.ts';
import type { PlanEvent, PlanRequest } from '../shared/protocol/credential-plan.mts';
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
function batch(): DigestBatch {
  return {
    id: 'digest-test',
    windowId: 1,
    windowTitle: 'Research',
    accountId: 'account',
    credentialOwner: 'saul',
    createdAt: 1,
    model: 'gpt-6-luna',
    effort: 'medium',
    prompt: 'prompt',
    items: [0, 1, 2].map((index) => ({
      index,
      tabId: index,
      title: 'Article',
      url: 'https://example.com/' + index,
      status: 'queued',
      raw: '',
    })),
  };
}
function fixture() {
  const saved = new Map<string, DigestBatch>();
  const sources = new Map<string, DigestSource>();
  const get = (id = 'digest-test') => saved.get(id)!;
  const db = vi.fn(async (r: DbRequest) => {
    switch (r.type) {
      case 'DB_DIGEST_FIND': {
        const { actionRevision, actionPresetId, urls } = r.payload;
        return structuredClone(
          [...saved.values()].find(
            (batch) =>
              batch.action?.revision.revision === actionRevision &&
              batch.action?.presetId === actionPresetId &&
              batch.items.length === urls.length &&
              batch.items.every(
                (item, index) => item.status === 'completed' && item.url === urls[index],
              ),
          ),
        );
      }
      case 'DB_DIGEST_RECOVER':
        return;
      case 'DB_DIGEST_CREATE':
        if (!saved.has(r.payload.id)) saved.set(r.payload.id, structuredClone(r.payload));
        return structuredClone(get(r.payload.id));
      case 'DB_DIGEST_GET':
        return structuredClone(get(r.payload.id));
      case 'DB_DIGEST_RETRY': {
        const batch = get(r.payload.id);
        batch.items = batch.items.map((item) => (retryableItem(item) ? restartItem(item) : item));
        delete batch.error;
        return structuredClone(batch);
      }
      case 'DB_DIGEST_INTERRUPT': {
        const batch = get(r.payload.id);
        if (batch.items.some(activeItem)) batch.error = r.payload.error;
        const error = r.payload.error;
        batch.items = batch.items.map((item) =>
          activeItem(item) ? interruptItem(item, error) : item,
        );
        return structuredClone(batch);
      }
      case 'DB_DIGEST_SOURCE':
        return sources.get(r.payload.id + ':' + r.payload.index);
      case 'DB_DIGEST_ITEM':
        get(r.payload.id).items[r.payload.item.index] = structuredClone(r.payload.item);
        if (r.payload.source)
          sources.set(r.payload.id + ':' + r.payload.item.index, r.payload.source);
        return;
      default:
        throw new Error('Unexpected request');
    }
  });
  const capture = vi.fn(async () => ({
    text: 'Frozen article',
    coverage: 'Visible only',
    capturedAt: 1,
    truncated: false,
  }));
  return { db: db as unknown as DbCall, mock: db, capture, get };
}
async function* success(): AsyncGenerator<Extract<PlanEvent, { type: 'delta' | 'complete' }>> {
  yield { type: 'delta', text: raw };
  yield { type: 'complete' };
}
async function waitDone(r: CallBatchRunner) {
  await vi.waitFor(async () => {
    const b = (await r.request({ action: 'get', id: 'digest-test' })) as DigestBatch;
    expect(b.items.some(activeItem)).toBe(false);
  });
}
describe('Call batches', () => {
  it('inspects a surviving item at its original index when another item is hidden', async () => {
    const f = fixture();
    const record = batch();
    const item = record.items[2]!;
    const source = {
      text: 'Third page evidence',
      coverage: 'Visible',
      capturedAt: 1,
      truncated: false,
    };
    await f.mock({ type: 'DB_DIGEST_CREATE', payload: record });
    await f.mock({ type: 'DB_DIGEST_ITEM', payload: { id: record.id, item, source } });
    f.get().items = f.get().items.filter((entry) => entry.index !== 1);
    const runner = new CallBatchRunner(f.db, f.capture);
    expect(await runner.request({ action: 'inspect', id: record.id, index: 2 })).toEqual({
      saved: source,
    });
    await expect(runner.request({ action: 'inspect', id: record.id, index: 1 })).rejects.toThrow(
      'source does not exist',
    );
  });

  it('sends saved PDF URL attachments on retry, discloses unverified contents, and compares changed processing modes without inference', async () => {
    const f = fixture();
    const source: DigestSource = {
      kind: 'pdf-url',
      attachment: { type: 'pdf-url', url: 'https://example.com/paper.pdf' },
      coverage: 'PDF URL; contents are not frozen.',
      truncated: false,
      capturedAt: 1,
    };
    const capture = vi.fn(async (): Promise<DigestSource> => source);
    const generate = vi.fn(async function* (_request: PlanRequest) {
      yield* success();
    });
    const r = new CallBatchRunner(f.db, capture, createCallExecutor({ plan: generate }));
    const b = { ...batch(), pdfProcessing: 'attachment' as const };
    await r.request({ action: 'start', id: b.id }, b);
    await waitDone(r);
    expect(generate.mock.calls[0]?.[0]).toMatchObject({ attachments: [source.attachment] });
    expect(f.get().items[0]?.sourceKind).toBe('pdf-url');
    const unchanged = (await r.request({ action: 'resolve', id: 'new-summary' }, b)) as {
      comparisons: { text?: unknown; notice?: string }[];
    };
    expect(unchanged.comparisons[0]?.text).toBeUndefined();
    expect(unchanged.comparisons[0]?.notice).toContain('matching URL does not prove');
    capture.mockResolvedValue({
      text: 'Locally extracted text',
      truncated: false,
      capturedAt: 2,
      coverage: 'Local PDF',
    });
    const changed = (await r.request(
      { action: 'resolve', id: 'new-summary' },
      { ...b, pdfProcessing: 'local' },
    )) as { comparisons: { fields: string[] }[] };
    expect(changed.comparisons[0]?.fields).toContain('PDF processing');
    expect(generate).toHaveBeenCalledTimes(3);
    f.get().items[0]!.status = 'cancelled';
    const captures = capture.mock.calls.length;
    await r.request({ action: 'retry', id: b.id });
    await waitDone(r);
    expect(capture).toHaveBeenCalledTimes(captures);
    expect(generate.mock.calls.at(-1)?.[0]).toMatchObject({ attachments: [source.attachment] });
  });
  it('rejects reversed languages and verbose output, accepts concise pairs', () => {
    expect(parseSummary(raw)).toEqual(summary);
    expect(() =>
      parseSummary(JSON.stringify({ ...summary, lead: { en: pair.zh, zh: pair.en } })),
    ).toThrow(/reversed/);
    expect(() =>
      parseSummary(JSON.stringify({ ...summary, lead: { ...pair, en: 'word '.repeat(211) } })),
    ).toThrow(/length limit/);
  });
  it('removes optional elaboration as whole pairs while retaining core points and caveats', () => {
    const core = { en: 'evidence '.repeat(25).trim(), zh: '核心证据。' };
    const optional = { en: 'detail '.repeat(25).trim(), zh: '补充细节。' };
    const input = {
      lead: core,
      points: [core, core, core, core],
      caution: core,
      flow: [optional, optional],
      terms: [optional],
      question: optional,
    };
    const raw = JSON.stringify(input);
    const compact = parseSummary(raw);
    expect(compact).toEqual({ ...input, question: null, terms: [], flow: [] });
    expect(JSON.parse(raw)).toEqual(input);
    expect(compact.caution).toEqual(core);
  });
  it('exports English first, safe source links, all incomplete statuses and escaped text', () => {
    const b = batch();
    b.items[0]!.summary = {
      ...summary,
      lead: { en: '<img src=x onerror=alert(1)> English.', zh: '中文内容。' },
    };
    b.items[0]!.status = 'completed';
    b.items[1]!.url = 'javascript:alert(1)';
    b.items[1]!.title = '<script>bad()</script>';
    const html = digestHtml(b);
    expect(html).toContain('https://example.com/0');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
    expect(html.indexOf('English.')).toBeLessThan(html.indexOf('中文内容。'));
    expect(html).toContain('queued');
  });
  it('validates action boundaries', () => {
    expect(() => validateCallControl({ action: 'get', id: 'valid' })).not.toThrow();
    for (const r of [
      { action: 'start', id: 'valid' },
      { action: 'list', source: 'injected' },
      { action: '__proto__' },
    ])
      expect(() => validateCallControl(r)).toThrow();
  });
  it('finishes in source order and duplicate IDs never regenerate', async () => {
    const f = fixture(),
      generate = vi.fn(success),
      r = new CallBatchRunner(f.db, f.capture, createCallExecutor({ plan: generate }));
    await r.request({ action: 'start', id: 'digest-test' }, batch());
    await waitDone(r);
    expect(f.get().items.map((i) => i.status)).toEqual(['completed', 'completed', 'completed']);
    await r.request({ action: 'start', id: 'digest-test' }, batch());
    expect(generate).toHaveBeenCalledTimes(3);
  });
  it('stop cancels active and queued work; explicit retry uses frozen source', async () => {
    const f = fixture();
    let hold = true;
    const generate = vi.fn(async function* (
      _request: unknown,
      signal?: AbortSignal,
    ): AsyncGenerator<PlanEvent> {
      if (hold) {
        yield { type: 'delta', text: 'partial' };
        await new Promise<void>((resolve) =>
          signal!.addEventListener('abort', () => resolve(), { once: true }),
        );
        signal!.throwIfAborted();
      }
      yield* success();
    });
    const r = new CallBatchRunner(f.db, f.capture, createCallExecutor({ plan: generate }));
    await r.request({ action: 'start', id: 'digest-test' }, batch());
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    await r.request({ action: 'stop', id: 'digest-test' });
    expect(f.get().items.map((i) => i.status)).toEqual(['cancelled', 'cancelled', 'cancelled']);
    expect(f.get().items[0]!.raw).toBe('partial');
    hold = false;
    await r.request({ action: 'retry', id: 'digest-test' });
    await waitDone(r);
    expect(f.capture).toHaveBeenCalledTimes(3);
    expect(generate).toHaveBeenCalledTimes(5);
  });
  it('pauses after provider failure without spending requests on the remaining tabs', async () => {
    const f = fixture();
    const generate = vi.fn(async function* (): AsyncGenerator<PlanEvent> {
      yield { type: 'delta', text: 'partial' };
      throw new Error('Usage limit reached');
    });
    const r = new CallBatchRunner(f.db, f.capture, createCallExecutor({ plan: generate }));
    await r.request({ action: 'start', id: 'digest-test' }, batch());
    await waitDone(r);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(f.get().items.map((i) => i.status)).toEqual(['failed', 'failed', 'interrupted']);
    expect(f.get().items[0]!.error).toContain('Usage limit');
    expect(f.get().items[0]!.raw).toBe('partial');
  });
  it('Stop aborts in-flight capture without persisting late input or calling a provider', async () => {
    const f = fixture();
    const capture = vi.fn(
      (_item: unknown, signal?: AbortSignal) =>
        new Promise<DigestSource>((_resolve, reject) => {
          signal!.addEventListener('abort', () => reject(new Error('Stopped.')), { once: true });
        }),
    );
    const generate = vi.fn(success);
    const r = new CallBatchRunner(f.db, capture, createCallExecutor({ plan: generate }));
    await r.request({ action: 'start', id: 'digest-test' }, batch());
    await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(2));
    await r.request({ action: 'stop', id: 'digest-test' });
    expect(f.get().items.map((i) => i.status)).toEqual(['cancelled', 'cancelled', 'cancelled']);
    expect(generate).not.toHaveBeenCalled();
    expect(
      f.mock.mock.calls.some(
        ([request]) => request.type === 'DB_DIGEST_ITEM' && request.payload.source,
      ),
    ).toBe(false);
  });
  it('retains malformed output as failed and continues other tabs without automatic retries', async () => {
    const f = fixture();
    let calls = 0;
    const generate = vi.fn(async function* (): AsyncGenerator<PlanEvent> {
      calls++;
      if (calls === 1) {
        yield { type: 'delta', text: 'not JSON' };
        yield { type: 'complete' };
      } else yield* success();
    });
    const r = new CallBatchRunner(f.db, f.capture, createCallExecutor({ plan: generate }));
    await r.request({ action: 'start', id: 'digest-test' }, batch());
    await waitDone(r);
    expect(generate).toHaveBeenCalledTimes(3);
    expect(f.get().items.map((i) => i.status)).toEqual(['failed', 'completed', 'completed']);
    expect(f.get().items[0]!.raw).toBe('not JSON');
    expect(f.get().items[0]!.summary).toBeUndefined();
  });
  it('does not process another tab after a save failure', async () => {
    const f = fixture(),
      original = f.mock.getMockImplementation()!;
    f.mock.mockImplementation(async (r) => {
      if (r.type === 'DB_DIGEST_ITEM' && r.payload.item.status === 'completed')
        throw new Error('disk full');
      return original(r);
    });
    const generate = vi.fn(success),
      r = new CallBatchRunner(f.db, f.capture, createCallExecutor({ plan: generate }));
    await r.request({ action: 'start', id: 'digest-test' }, batch());
    await waitDone(r);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(
      ((await r.request({ action: 'get', id: 'digest-test' })) as DigestBatch).error,
    ).toContain('disk full');
  });
});

it('starts a different source while a stopped summary is still settling', async () => {
  const f = fixture();
  const first = batch();
  first.items = first.items.slice(0, 1);
  const other = structuredClone(first);
  other.id = 'other';
  other.items[0]!.url = 'https://example.com/other';
  const aborted = Promise.withResolvers<void>();
  const settle = Promise.withResolvers<void>();
  const generate = vi.fn(async function* (request: PlanRequest, signal?: AbortSignal) {
    if (request.action === 'generate' && request.userPrompt.includes(first.items[0]!.url)) {
      signal!.addEventListener('abort', () => aborted.resolve(), { once: true });
      await settle.promise;
      signal!.throwIfAborted();
    }
    yield* success();
  });
  const runner = new CallBatchRunner(f.db, f.capture, createCallExecutor({ plan: generate }));
  const start = (batch: DigestBatch) => runner.request({ action: 'start', id: batch.id }, batch);
  await start(first);
  await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
  const stopping = runner.request({ action: 'stop', id: first.id });
  await aborted.promise;
  try {
    const starting = start(other);
    await vi.waitFor(() => expect(f.get(other.id)?.items[0]?.status).toBe('completed'));
    await starting;
    expect(f.get(first.id).items[0]?.status).toBe('running');
  } finally {
    settle.resolve();
    await stopping;
  }
  expect(f.get(first.id).items[0]?.status).toBe('cancelled');
});

it('bounds workers at two and retains source order when later items finish first', async () => {
  const f = fixture();
  const releases = new Map<number, () => void>();
  let active = 0,
    maximum = 0;
  const completed: number[] = [];
  const generate = async function* (request: PlanRequest): AsyncGenerator<PlanEvent> {
    if (request.action !== 'generate') throw new Error('Expected generation');
    const index = Number(JSON.parse(request.userPrompt).url.split('/').at(-1));
    active++;
    maximum = Math.max(maximum, active);
    await new Promise<void>((resolve) => releases.set(index, resolve));
    active--;
    completed.push(index);
    yield* success();
  };
  const runner = new CallBatchRunner(f.db, f.capture, createCallExecutor({ plan: generate }));
  await runner.request({ action: 'start', id: 'digest-test' }, batch());
  await vi.waitFor(() => expect(releases.size).toBe(2));
  expect(releases.has(2)).toBe(false);
  releases.get(1)!();
  await vi.waitFor(() => expect(releases.has(2)).toBe(true));
  releases.get(2)!();
  await vi.waitFor(() => expect(completed).toEqual([1, 2]));
  releases.get(0)!();
  await waitDone(runner);
  expect(maximum).toBe(2);
  expect(f.get().items.map((i) => i.index)).toEqual([0, 1, 2]);
  expect(f.get().items.every((i) => i.status === 'completed')).toBe(true);
});

it('a storage failure aborts a sibling stream before a new control can proceed', async () => {
  const f = fixture(),
    original = f.mock.getMockImplementation()!;
  let siblingAborted = false,
    firstRelease: () => void = () => {};
  f.mock.mockImplementation(async (r) => {
    if (
      r.type === 'DB_DIGEST_ITEM' &&
      r.payload.item.index === 0 &&
      r.payload.item.status === 'completed'
    )
      throw new Error('disk full');
    return original(r);
  });
  const generate = async function* (
    request: PlanRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<PlanEvent> {
    if (request.action !== 'generate') throw new Error('Expected generation');
    const index = Number(JSON.parse(request.userPrompt).url.split('/').at(-1));
    if (index === 0)
      await new Promise<void>((resolve) => {
        firstRelease = resolve;
      });
    else
      await new Promise<void>((resolve) =>
        signal!.addEventListener(
          'abort',
          () => {
            siblingAborted = true;
            resolve();
          },
          { once: true },
        ),
      );
    signal!.throwIfAborted();
    yield* success();
  };
  const runner = new CallBatchRunner(f.db, f.capture, createCallExecutor({ plan: generate }));
  await runner.request({ action: 'start', id: 'digest-test' }, batch());
  await vi.waitFor(() => expect(f.capture).toHaveBeenCalledTimes(2));
  firstRelease();
  await waitDone(runner);
  expect(siblingAborted).toBe(true);
  expect(f.capture).toHaveBeenCalledTimes(2);
  const current = (await runner.request({ action: 'get', id: 'digest-test' })) as DigestBatch;
  expect(current.error).toContain('disk full');
  expect(current.items[0]!.status).toBe('interrupted');
});

it('reuses saved output before inference, measures changed input, and keeps a cache when capture fails', async () => {
  const f = fixture(),
    generate = vi.fn(success);
  const runner = new CallBatchRunner(f.db, f.capture, createCallExecutor({ plan: generate }));
  await runner.request({ action: 'start', id: 'digest-test' }, batch());
  await waitDone(runner);
  const next = batch();
  next.id = 'new-click';
  const same = (await runner.request(
    { action: 'resolve', id: next.id },
    next,
  )) as import('../shared/model/call-batch.ts').DigestResolution;
  expect(same.batch?.id).toBe('digest-test');
  expect(same.comparisons.every((c) => c.text?.kind === 'same')).toBe(true);
  f.capture.mockResolvedValue({
    text: 'Frozen article with a new finding',
    coverage: 'Visible only',
    capturedAt: 2,
    truncated: false,
  });
  const changed = (await runner.request(
    { action: 'resolve', id: next.id },
    next,
  )) as import('../shared/model/call-batch.ts').DigestResolution;
  expect(changed.comparisons[0]?.text).toMatchObject({ kind: 'changed', added: 4 });
  f.capture.mockRejectedValue(new Error('Source tab unavailable'));
  const unavailable = (await runner.request(
    { action: 'resolve', id: next.id },
    next,
  )) as import('../shared/model/call-batch.ts').DigestResolution;
  expect(unavailable.batch?.id).toBe('digest-test');
  expect(unavailable.comparisons[0]?.error).toContain('Source tab unavailable');
  const reused = (await runner.request({ action: 'start', id: next.id }, next)) as DigestBatch;
  expect(reused.id).toBe('digest-test');
  expect(generate).toHaveBeenCalledTimes(3);
  expect(f.get().items.every((item) => item.status === 'completed')).toBe(true);
});
it('validates source selection, explicit review and public reader commands', () => {
  expect(() => validateCallControl({ action: 'inspect', id: 'saved', index: 0 })).not.toThrow();
  expect(() => validateCallControl({ action: 'inspect', id: 'saved', index: -1 })).toThrow();
  expect(() =>
    validateCallControl({ action: 'inspect', id: 'saved', index: 0, tabId: -1 }),
  ).toThrow();
  const start = { id: 'new', tabIds: [1, 2] };
  expect(() => validateCallLaunch(start)).not.toThrow();
  for (const invalid of [
    { ...start, tabIds: [1, 1] },
    { ...start, tabIds: [-1] },
    { ...start, accountId: 'other' },
    { ...start, review: { presetId: 'other' } },
    { ...start, previousBatchId: 'new' },
  ])
    expect(() => validateCallLaunch(invalid)).toThrow();
});

function customBatch(revision = 'a'.repeat(64)): DigestBatch {
  return {
    ...batch(),
    summaryInput: undefined,
    action: {
      revision: {
        contractVersion: 1,
        revision,
        name: 'Custom',
        description: '',
        language: 'typescript',
        source: 'export default () => "answer";',
        createdAt: 1,
        approved: true,
      },
      presetId: 'action-preset',
      input: {
        provider: 'chatgpt-plan',
        plan: { accountId: 'frozen', model: 'chosen', effort: 'low' },
        remote: { baseUrl: '', model: '', temperature: 0.3 },
        local: { topK: 3, temperature: 0.3 },
      },
    },
  };
}
it('runs custom actions per page with two-page concurrency and pins code and preset while the selection changes', async () => {
  const f = fixture();
  const releases = new Map<number, () => void>();
  const calls: string[] = [];
  let active = 0,
    maximum = 0;
  const custom = vi.fn<typeof actionHost>(async (request, options) => {
    if (request.action !== 'run') throw new Error('Unexpected host request');
    const index = Number(new URL(request.source.url).pathname.slice(1));
    calls.push(request.revision);
    active++;
    maximum = Math.max(maximum, active);
    await new Promise<void>((resolve) => releases.set(index, resolve));
    await options!.generate!({ instructions: 'Custom instructions' }, options!.signal!);
    active--;
    return { type: 'result', text: 'Final ' + index };
  });
  const builtIn = vi.fn(success);
  const model = vi.fn<typeof import('../src/providers/stream').streamModel>(success);
  const runner = new CallBatchRunner(
    f.db,
    f.capture,
    createCallExecutor({ plan: builtIn, model, script: custom }),
  );
  const original = customBatch();
  await runner.request({ action: 'start', id: original.id }, original);
  await vi.waitFor(() => expect(releases.size).toBe(2));
  const newChoice = customBatch('b'.repeat(64));
  const resolution = await runner.request({ action: 'resolve', id: 'new' }, newChoice);
  expect(resolution).toEqual({ comparisons: [] });
  releases.get(1)!();
  await vi.waitFor(() => expect(releases.has(2)).toBe(true));
  releases.get(2)!();
  releases.get(0)!();
  await waitDone(runner);
  expect(maximum).toBe(2);
  expect(builtIn).not.toHaveBeenCalled();
  expect(calls).toEqual(Array(3).fill('a'.repeat(64)));
  expect(model.mock.calls.every(([input]) => input.plan?.model === 'chosen')).toBe(true);
  expect(f.get().items.map((item) => item.finalText)).toEqual(['Final 0', 'Final 1', 'Final 2']);
  expect(f.get().items.every((item) => item.summary === undefined)).toBe(true);
});
it('keeps custom intermediate output separate from a failed final result without replay', async () => {
  const f = fixture();
  const custom = vi.fn<typeof actionHost>(async (_request, options) => {
    await options!.generate!(
      { instructions: 'Frozen instructions', input: 'Captured source' },
      options!.signal!,
    );
    throw new Error('Module failed after model completion');
  });
  const model = async function* () {
    yield { type: 'delta' as const, text: 'intermediate model response' };
    yield { type: 'complete' as const };
  };
  const runner = new CallBatchRunner(
    f.db,
    f.capture,
    createCallExecutor({ model, script: custom }),
  );
  await runner.request({ action: 'start', id: 'digest-test' }, customBatch());
  await waitDone(runner);
  expect(custom).toHaveBeenCalledTimes(2);
  expect(f.get().items[0]).toMatchObject({ status: 'failed', raw: 'intermediate model response' });
  expect(f.get().items[0]?.finalText).toBeUndefined();
  expect(digestHtml(f.get())).not.toContain('<pre>intermediate model response</pre>');
});
it('a custom terminal save failure aborts its sibling and removes the unsaved final projection', async () => {
  const f = fixture();
  const db = f.mock.getMockImplementation()!;
  f.mock.mockImplementation(async (r) => {
    if (r.type === 'DB_DIGEST_ITEM' && r.payload.item.status === 'completed')
      throw new Error('disk full');
    return db(r);
  });
  const custom = vi.fn<typeof actionHost>(async (request, options) => {
    if (request.action !== 'run') throw new Error('Unexpected host request');
    if (request.source.url.endsWith('/0')) return { type: 'result', text: 'Unsaved final' };
    const signal = options!.signal!;
    await new Promise<void>((resolve) =>
      signal.addEventListener('abort', () => resolve(), { once: true }),
    );
    signal.throwIfAborted();
    return { type: 'result', text: 'unreachable' };
  });
  const runner = new CallBatchRunner(f.db, f.capture, createCallExecutor({ script: custom }));
  await runner.request({ action: 'start', id: 'digest-test' }, customBatch());
  await waitDone(runner);
  const current = (await runner.request({ action: 'get', id: 'digest-test' })) as DigestBatch;
  expect(current.error).toContain('disk full');
  expect(current.items[0]?.finalText).toBeUndefined();
  expect(custom).toHaveBeenCalledTimes(2);
});
it('exports custom final text safely with its actual action and preset labels', () => {
  const b = customBatch();
  b.items[0]!.status = 'completed';
  b.items[0]!.finalText = '<script>danger()</script> **plain export**';
  const html = digestHtml(b);
  expect(html).toContain('&lt;script&gt;danger()');
  expect(html).not.toContain('<script>');
  expect(html).toContain('Custom · Saved preset');
  expect(html).not.toContain('GPT-6 Luna');
});

it.each(['preset', 'script'] as const)(
  '%s Stop retains partial output; Retry uses frozen input without recapture',
  async (kind) => {
    const f = fixture();
    let hold = true;
    const model = vi.fn<typeof import('../src/providers/stream').streamModel>(
      async function* (_input, _credential, signal) {
        if (hold) {
          yield { type: 'delta', text: 'partial' };
          await new Promise<void>((resolve) =>
            signal!.addEventListener('abort', () => resolve(), { once: true }),
          );
          signal!.throwIfAborted();
        }
        yield* success();
      },
    );
    const host: typeof actionHost = async (_request, options) => ({
      type: 'result',
      text: await options!.generate!({ instructions: 'Frozen instructions' }, options!.signal!),
    });
    const selected = customBatch();
    const saved =
      kind === 'script' ? selected : { ...batch(), summaryInput: selected.action!.input };
    const runner = new CallBatchRunner(
      f.db,
      f.capture,
      createCallExecutor({ model, script: host }),
    );
    await runner.request({ action: 'start', id: saved.id }, saved, 'credential');
    await vi.waitFor(() => expect(model).toHaveBeenCalledTimes(2));
    await runner.request({ action: 'stop', id: saved.id });
    expect(f.get().items.map((item) => item.status)).toEqual([
      'cancelled',
      'cancelled',
      'cancelled',
    ]);
    expect(f.get().items[0]?.raw).toBe('partial');
    selected.action!.input!.plan!.model = 'Changed selection';
    hold = false;
    await runner.request({ action: 'retry', id: saved.id }, undefined, 'credential');
    await waitDone(runner);
    expect(f.capture).toHaveBeenCalledTimes(3);
    expect(model).toHaveBeenCalledTimes(5);
    expect(model.mock.calls.every(([input]) => input.plan?.model === 'chosen')).toBe(true);
    expect(f.get().items.every((item) => item.status === 'completed')).toBe(true);
  },
);

it('a custom checkpoint failure cancels execution and siblings without saving a final result', async () => {
  const f = fixture();
  const db = f.mock.getMockImplementation()!;
  f.mock.mockImplementation(async (request) => {
    if (
      request.type === 'DB_DIGEST_ITEM' &&
      request.payload.item.status === 'running' &&
      request.payload.item.raw
    )
      throw new Error('checkpoint disk full');
    return db(request);
  });
  const model = vi.fn<typeof import('../src/providers/stream').streamModel>(
    async function* (_input, _credential, signal) {
      yield { type: 'delta', text: 'partial' };
      await new Promise<void>((resolve) =>
        signal!.addEventListener('abort', () => resolve(), { once: true }),
      );
      signal!.throwIfAborted();
    },
  );
  const host: typeof actionHost = async (_request, options) => ({
    type: 'result',
    text: await options!.generate!({ instructions: 'Work' }, options!.signal!),
  });
  const runner = new CallBatchRunner(f.db, f.capture, createCallExecutor({ model, script: host }));
  await runner.request({ action: 'start', id: 'digest-test' }, customBatch());
  await vi.waitFor(
    async () => {
      const current = (await runner.request({ action: 'get', id: 'digest-test' })) as DigestBatch;
      expect(current.error).toContain('checkpoint disk full');
      expect(current.items.every((item) => !item.finalText && !item.summary)).toBe(true);
    },
    { timeout: 2000 },
  );
  expect(model).toHaveBeenCalledTimes(2);
  expect(model.mock.calls.every(([, , signal]) => signal?.aborted)).toBe(true);
  expect(f.capture).toHaveBeenCalledTimes(2);
});

it('pauses unstarted pages on a Call failure before a pending checkpoint settles', async () => {
  const f = fixture();
  const db = f.mock.getMockImplementation()!;
  let releaseCheckpoint!: () => void;
  f.mock.mockImplementation(async (request) => {
    if (
      request.type === 'DB_DIGEST_ITEM' &&
      request.payload.item.index === 0 &&
      request.payload.item.progress === 'Waiting'
    ) {
      await new Promise<void>((resolve) => {
        releaseCheckpoint = resolve;
      });
    }
    return db(request);
  });
  let failFirst!: () => void;
  let finishSecond!: () => void;
  const host = vi.fn<typeof actionHost>(async (request, options) => {
    if (request.action !== 'run') throw new Error('Unexpected request');
    if (request.source.url.endsWith('/0')) {
      options!.progress!('Waiting');
      await new Promise<void>((_resolve, reject) => {
        failFirst = () => reject(new Error('Call failed'));
      });
    } else {
      await new Promise<void>((resolve) => {
        finishSecond = resolve;
      });
    }
    return { type: 'result', text: 'Completed sibling' };
  });
  const runner = new CallBatchRunner(f.db, f.capture, createCallExecutor({ script: host }));
  await runner.request({ action: 'start', id: 'digest-test' }, customBatch());
  try {
    await vi.waitFor(() => expect(releaseCheckpoint).toBeTypeOf('function'), { timeout: 2000 });
    failFirst();
    // Let the failure reach the runner while its checkpoint remains held.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    finishSecond();
    await vi.waitFor(() => expect(f.get().items[1]?.status).toBe('completed'));
    expect(host).toHaveBeenCalledTimes(2);
    expect(f.capture).toHaveBeenCalledTimes(2);
  } finally {
    releaseCheckpoint?.();
    finishSecond?.();
    failFirst?.();
  }
  await waitDone(runner);
  expect(f.get().items.map((item) => item.status)).toEqual(['failed', 'completed', 'interrupted']);
});

it.each(['failed', 'cancelled'] as const)(
  'does not settle a %s Call while its last checkpoint is still pending',
  async (status) => {
    const f = fixture();
    const db = f.mock.getMockImplementation()!;
    let releaseCheckpoint!: () => void;
    f.mock.mockImplementation(async (request) => {
      if (request.type === 'DB_DIGEST_ITEM' && request.payload.item.progress === 'Waiting') {
        await new Promise<void>((resolve) => {
          releaseCheckpoint = resolve;
        });
      }
      return db(request);
    });
    let fail!: () => void;
    const host: typeof actionHost = async (_request, options) => {
      options!.progress!('Waiting');
      await new Promise<void>((_resolve, reject) => {
        fail = () => reject(new Error('Call failed'));
        options!.signal!.addEventListener('abort', () => reject(new Error('Stopped.')), {
          once: true,
        });
      });
      return { type: 'result', text: 'unreachable' };
    };
    const runner = new CallBatchRunner(f.db, f.capture, createCallExecutor({ script: host }));
    const saved = customBatch();
    saved.items = saved.items.slice(0, 1);
    let stopping: Promise<unknown> | undefined;
    await runner.request({ action: 'start', id: saved.id }, saved);
    try {
      await vi.waitFor(() => expect(releaseCheckpoint).toBeTypeOf('function'), { timeout: 2000 });
      if (status === 'cancelled') stopping = runner.request({ action: 'stop', id: saved.id });
      else fail();
      await vi.waitFor(async () => {
        const current = (await runner.request({ action: 'get', id: saved.id })) as DigestBatch;
        expect(current.items[0]?.status).toBe('saving');
        expect(current.items[0]?.finalText).toBeUndefined();
      });
      expect(f.get().items[0]?.status).toBe('running');
    } finally {
      releaseCheckpoint?.();
      fail?.();
      await stopping;
      await waitDone(runner);
    }
    await vi.waitFor(() => expect(f.get().items[0]?.status).toBe(status));
  },
);
