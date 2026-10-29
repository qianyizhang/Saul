import { describe, it, expect, vi } from 'vitest';
import { parseSummary } from '../src/digest/summary';
import { digestHtml } from '../src/digest/html';
import { validateDigest } from '../src/digest/contracts';
import { DigestRunner } from '../src/digest/runner';
import type { DigestBatch, DigestSource } from '../src/digest/types';
import type { DbCall, DbRequest } from '../src/types/storage';
import type { PlanEvent, PlanRequest } from '../native/plan-protocol.mts';
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
  let saved: DigestBatch;
  const sources = new Map<number, DigestSource>();
  const db = vi.fn(async (r: DbRequest) => {
    switch (r.type) {
      case 'DB_DIGEST_FIND':
        return saved?.items.every(
          (item, index) => item.status === 'completed' && item.url === r.payload.urls[index],
        ) && saved.items.length === r.payload.urls.length
          ? structuredClone(saved)
          : undefined;
      case 'DB_DIGEST_RECOVER':
        return;
      case 'DB_DIGEST_CREATE':
        saved ??= structuredClone(r.payload);
        return structuredClone(saved);
      case 'DB_DIGEST_GET':
        return structuredClone(saved);
      case 'DB_DIGEST_SOURCE':
        return sources.get(r.payload.index);
      case 'DB_DIGEST_ITEM':
        saved.items[r.payload.item.index] = structuredClone(r.payload.item);
        if (r.payload.source) sources.set(r.payload.item.index, r.payload.source);
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
  return { db: db as unknown as DbCall, mock: db, capture, get: () => saved };
}
async function* success(): AsyncGenerator<PlanEvent> {
  yield { type: 'delta', text: raw };
  yield { type: 'complete' };
}
async function waitDone(r: DigestRunner) {
  await vi.waitFor(async () => {
    const b = (await r.request({ action: 'get', id: 'digest-test' })) as DigestBatch;
    expect(b.items.some((i) => ['queued', 'capturing', 'running'].includes(i.status))).toBe(false);
  });
}
describe('window digests', () => {
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
    const r = new DigestRunner(f.db, capture, generate);
    const b = { ...batch(), pdfProcessing: 'attachment' as const };
    await r.request({ action: 'start', id: b.id, tabIds: [0, 1, 2], accountId: b.accountId }, b);
    await waitDone(r);
    expect(generate.mock.calls[0]?.[0]).toMatchObject({ attachments: [source.attachment] });
    expect(f.get().items[0]?.sourceKind).toBe('pdf-url');
    const unchanged = (await r.request(
      { action: 'resolve', id: 'new-summary', tabIds: [0, 1, 2] },
      b,
    )) as { comparisons: { text?: unknown; notice?: string }[] };
    expect(unchanged.comparisons[0]?.text).toBeUndefined();
    expect(unchanged.comparisons[0]?.notice).toContain('matching URL does not prove');
    capture.mockResolvedValue({
      text: 'Locally extracted text',
      truncated: false,
      capturedAt: 2,
      coverage: 'Local PDF',
    });
    const changed = (await r.request(
      { action: 'resolve', id: 'new-summary', tabIds: [0, 1, 2] },
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
    expect(() =>
      validateDigest({ action: 'start', id: 'valid', tabIds: [1], accountId: 'saved' }),
    ).not.toThrow();
    for (const r of [
      { action: 'start', id: 'valid', tabIds: [-1], accountId: 'saved' },
      { action: 'list', source: 'injected' },
      { action: '__proto__' },
    ])
      expect(() => validateDigest(r)).toThrow();
  });
  it('finishes in source order and duplicate IDs never regenerate', async () => {
    const f = fixture(),
      generate = vi.fn(success),
      r = new DigestRunner(f.db, f.capture, generate);
    await r.request(
      { action: 'start', id: 'digest-test', tabIds: [0, 1, 2], accountId: 'account' },
      batch(),
    );
    await waitDone(r);
    expect(f.get().items.map((i) => i.status)).toEqual(['completed', 'completed', 'completed']);
    await r.request(
      { action: 'start', id: 'digest-test', tabIds: [0, 1, 2], accountId: 'account' },
      batch(),
    );
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
    const r = new DigestRunner(f.db, f.capture, generate);
    await r.request(
      { action: 'start', id: 'digest-test', tabIds: [0, 1, 2], accountId: 'account' },
      batch(),
    );
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
    const r = new DigestRunner(f.db, f.capture, generate);
    await r.request(
      { action: 'start', id: 'digest-test', tabIds: [0, 1, 2], accountId: 'account' },
      batch(),
    );
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
    const r = new DigestRunner(f.db, capture, generate);
    await r.request(
      { action: 'start', id: 'digest-test', tabIds: [0, 1, 2], accountId: 'account' },
      batch(),
    );
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
    const r = new DigestRunner(f.db, f.capture, generate);
    await r.request(
      { action: 'start', id: 'digest-test', tabIds: [0, 1, 2], accountId: 'account' },
      batch(),
    );
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
      r = new DigestRunner(f.db, f.capture, generate);
    await r.request(
      { action: 'start', id: 'digest-test', tabIds: [0, 1, 2], accountId: 'account' },
      batch(),
    );
    await waitDone(r);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(
      ((await r.request({ action: 'get', id: 'digest-test' })) as DigestBatch).error,
    ).toContain('disk full');
  });
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
  const runner = new DigestRunner(f.db, f.capture, generate);
  await runner.request(
    { action: 'start', id: 'digest-test', tabIds: [0, 1, 2], accountId: 'account' },
    batch(),
  );
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
  const runner = new DigestRunner(f.db, f.capture, generate);
  await runner.request(
    { action: 'start', id: 'digest-test', tabIds: [0, 1, 2], accountId: 'account' },
    batch(),
  );
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
  const runner = new DigestRunner(f.db, f.capture, generate);
  await runner.request(
    { action: 'start', id: 'digest-test', tabIds: [0, 1, 2], accountId: 'account' },
    batch(),
  );
  await waitDone(runner);
  const next = batch();
  next.id = 'new-click';
  const same = (await runner.request(
    { action: 'resolve', id: next.id, tabIds: [0, 1, 2] },
    next,
  )) as import('../src/digest/types').DigestResolution;
  expect(same.batch?.id).toBe('digest-test');
  expect(same.comparisons.every((c) => c.text?.kind === 'same')).toBe(true);
  f.capture.mockResolvedValue({
    text: 'Frozen article with a new finding',
    coverage: 'Visible only',
    capturedAt: 2,
    truncated: false,
  });
  const changed = (await runner.request(
    { action: 'resolve', id: next.id, tabIds: [0, 1, 2] },
    next,
  )) as import('../src/digest/types').DigestResolution;
  expect(changed.comparisons[0]?.text).toMatchObject({ kind: 'changed', added: 4 });
  f.capture.mockRejectedValue(new Error('Source tab unavailable'));
  const unavailable = (await runner.request(
    { action: 'resolve', id: next.id, tabIds: [0, 1, 2] },
    next,
  )) as import('../src/digest/types').DigestResolution;
  expect(unavailable.batch?.id).toBe('digest-test');
  expect(unavailable.comparisons[0]?.error).toContain('Source tab unavailable');
  const reused = (await runner.request(
    { action: 'start', id: next.id, tabIds: [0, 1, 2], accountId: 'other' },
    next,
  )) as DigestBatch;
  expect(reused.id).toBe('digest-test');
  expect(generate).toHaveBeenCalledTimes(3);
  expect(f.get().items.every((item) => item.status === 'completed')).toBe(true);
});
it('validates inspection indices, comparison selections and explicit regeneration flags', () => {
  for (const request of [
    { action: 'inspect', id: 'saved', index: -1 },
    { action: 'inspect', id: 'saved', index: 0, tabId: -1 },
    { action: 'resolve', id: 'new', tabIds: [1, 1] },
    { action: 'start', id: 'new', tabIds: [1], accountId: 'a', regenerate: 'true' },
  ])
    expect(() => validateDigest(request)).toThrow();
  expect(() => validateDigest({ action: 'inspect', id: 'saved', index: 0 })).not.toThrow();
});
