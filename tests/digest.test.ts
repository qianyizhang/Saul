import { describe, it, expect, vi } from 'vitest';
import { parseSummary } from '../src/digest/summary';
import { digestHtml } from '../src/digest/html';
import { validateDigest } from '../src/digest/contracts';
import { DigestRunner } from '../src/digest/runner';
import type { DigestBatch, DigestSource } from '../src/digest/types';
import type { DbCall, DbRequest } from '../src/types/storage';
import type { PlanEvent } from '../native/plan-protocol.mjs';
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
      validateDigest({ action: 'start', id: 'valid', windowId: 1, accountId: 'saved' }),
    ).not.toThrow();
    for (const r of [
      { action: 'start', id: 'valid', windowId: -1, accountId: 'saved' },
      { action: 'list', source: 'injected' },
      { action: '__proto__' },
    ])
      expect(() => validateDigest(r)).toThrow();
  });
  it('finishes sequentially and duplicate IDs never regenerate', async () => {
    const f = fixture(),
      generate = vi.fn(success),
      r = new DigestRunner(f.db, f.capture, generate);
    await r.request(
      { action: 'start', id: 'digest-test', windowId: 1, accountId: 'account' },
      batch(),
    );
    await waitDone(r);
    expect(f.get().items.map((i) => i.status)).toEqual(['completed', 'completed', 'completed']);
    await r.request(
      { action: 'start', id: 'digest-test', windowId: 1, accountId: 'account' },
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
      { action: 'start', id: 'digest-test', windowId: 1, accountId: 'account' },
      batch(),
    );
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    await r.request({ action: 'stop', id: 'digest-test' });
    expect(f.get().items.map((i) => i.status)).toEqual(['cancelled', 'cancelled', 'cancelled']);
    expect(f.get().items[0]!.raw).toBe('partial');
    hold = false;
    await r.request({ action: 'retry', id: 'digest-test' });
    await waitDone(r);
    expect(f.capture).toHaveBeenCalledTimes(3);
    expect(generate).toHaveBeenCalledTimes(4);
  });
  it('pauses after provider failure without spending requests on the remaining tabs', async () => {
    const f = fixture();
    const generate = vi.fn(async function* (): AsyncGenerator<PlanEvent> {
      yield { type: 'delta', text: 'partial' };
      throw new Error('Usage limit reached');
    });
    const r = new DigestRunner(f.db, f.capture, generate);
    await r.request(
      { action: 'start', id: 'digest-test', windowId: 1, accountId: 'account' },
      batch(),
    );
    await waitDone(r);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(f.get().items.map((i) => i.status)).toEqual(['failed', 'interrupted', 'interrupted']);
    expect(f.get().items[0]!.error).toContain('Usage limit');
    expect(f.get().items[0]!.raw).toBe('partial');
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
      { action: 'start', id: 'digest-test', windowId: 1, accountId: 'account' },
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
      { action: 'start', id: 'digest-test', windowId: 1, accountId: 'account' },
      batch(),
    );
    await waitDone(r);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(
      ((await r.request({ action: 'get', id: 'digest-test' })) as DigestBatch).error,
    ).toContain('disk full');
  });
});
