import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ReadingRunner } from '../src/reading/runner';
import type { DbCall, DbRequest, Passage, Submission, RunStatus } from '../src/types/storage';
const mocks = vi.hoisted(() => ({ remote: vi.fn(), local: vi.fn() }));

const attemptContract = JSON.parse(
  readFileSync(new URL('../../../contracts/fixtures/attempts.json', import.meta.url), 'utf8'),
) as {
  version: number;
  cases: {
    id: string;
    text: string;
    providerOutcome: 'complete' | 'error' | 'eof' | 'cancel';
    initialSaveFails: boolean;
    finalSaveFails: boolean;
    expected: { providerCalls: number; hasOutput: boolean; savedSuccess: boolean };
  }[];
};
vi.mock('../src/models/openai-compatible', () => ({ streamOpenAICompatible: mocks.remote }));
// Exercise queue scheduling independently of the temporary product availability switch.
vi.mock('../src/models/chrome-ai', () => ({
  streamChromeAi: mocks.local,
  CHROME_AI_ENABLED: true,
  CHROME_AI_DISABLED_MESSAGE: 'Chrome on-device AI is temporarily disabled.',
}));
const submission = (id: string): Submission => ({
  submissionId: id,
  regenerate: true,
  snapshot: {
    id: 'passage',
    text: 'term',
    page: { url: 'https://test/', title: 'Test' },
    anchor: { exact: 'term', prefix: 'before ', suffix: ' after' },
    viewport: { x: 0, y: 0, width: 0, height: 0, scrollX: 0, scrollY: 0 },
    capturedAt: 1,
  },
  input: {
    provider: 'openai-compatible',
    remote: { baseUrl: 'https://model.test', model: 'model', temperature: 0.3 },
    local: { temperature: 0.3, topK: 3 },
    context: { selection: 'term', pageTitle: '', pageUrl: '' },
    systemPrompt: 'test',
    userPrompt: 'test',
  },
});
function store() {
  const rows = new Map<string, { status: RunStatus; raw: string }>();
  let finishFailures = 0,
    submitFailure = false;
  const call = vi.fn(async (message: DbRequest) => {
    switch (message.type) {
      case 'DB_RECOVER':
        return;
      case 'DB_SUBMIT': {
        if (submitFailure) throw new Error('Storage unavailable');
        if ([...rows.values()].some((r) => ['queued', 'running', 'saving'].includes(r.status)))
          return { passageId: 'passage' };
        const p = message.payload,
          id = p.submissionId;
        rows.set(id, { status: 'queued', raw: '' });
        return {
          passageId: 'passage',
          run: { id, selectionId: 'passage', pageUrl: p.snapshot.page.url, input: p.input },
        };
      }
      case 'DB_CLAIM':
        rows.get(message.payload.runId)!.status = 'running';
        return true;
      case 'DB_CHECKPOINT':
        rows.get(message.payload.runId)!.raw = message.payload.raw;
        return;
      case 'DB_SAVING':
        rows.get(message.payload.runId)!.status = 'saving';
        return true;
      case 'DB_FINISH':
        if (finishFailures-- > 0) throw new Error('Temporary disk failure');
        rows.set(message.payload.runId, {
          status: message.payload.status,
          raw: message.payload.raw,
        });
        return true;
      default:
        throw new Error('Unexpected test operation');
    }
  }) as unknown as DbCall;
  return {
    call,
    rows,
    failFinish: (n: number) => {
      finishFailures = n;
    },
    failSubmit: () => {
      submitFailure = true;
    },
  };
}
beforeEach(() => {
  mocks.remote.mockReset().mockImplementation(async function* () {
    yield { type: 'delta', text: 'Retained text' };
    yield { type: 'complete' };
  });
  mocks.local.mockReset().mockImplementation(mocks.remote);
});
for (const scenario of attemptContract.cases) {
  it(`satisfies shared Attempt contract: ${scenario.id}`, async () => {
    expect(attemptContract.version).toBe(1);
    const db = store();
    if (scenario.initialSaveFails) db.failSubmit();
    if (scenario.finalSaveFails) db.failFinish(2);
    mocks.remote.mockImplementation(async function* (_config, _system, _user, signal: AbortSignal) {
      yield { type: 'delta', text: scenario.text };
      if (scenario.providerOutcome === 'cancel') {
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener('abort', () => resolve(), { once: true });
        });
      } else if (scenario.providerOutcome === 'error') {
        throw new Error('Provider disconnected');
      } else if (scenario.providerOutcome === 'complete') {
        yield { type: 'complete' };
      }
    });
    const runner = new ReadingRunner(db.call, () => {});
    const current = () =>
      runner.decorateRun('passage', {
        id: scenario.id,
        status: db.rows.get(scenario.id)?.status ?? 'queued',
        responseRaw: db.rows.get(scenario.id)?.raw ?? '',
        provider: 'openai-compatible',
        model: 'model',
        createdAt: 1,
      });
    if (scenario.initialSaveFails) {
      await expect(runner.submit(submission(scenario.id), 'secret')).rejects.toThrow(
        'Storage unavailable',
      );
    } else {
      await runner.submit(submission(scenario.id), 'secret');
      if (scenario.providerOutcome === 'cancel') {
        await vi.waitFor(() => expect(db.rows.get(scenario.id)?.raw).toBe(scenario.text));
        await runner.stop('passage');
      }
      await vi.waitFor(() =>
        expect(['completed', 'failed', 'interrupted', 'cancelled']).toContain(current().status),
      );
    }
    expect(mocks.remote).toHaveBeenCalledTimes(scenario.expected.providerCalls);
    expect(current().responseRaw).toBe(scenario.expected.hasOutput ? scenario.text : '');
    expect(db.rows.get(scenario.id)?.status === 'completed').toBe(scenario.expected.savedSuccess);
  });
}
it('never starts a provider when durable submission fails', async () => {
  const db = store();
  db.failSubmit();
  const runner = new ReadingRunner(db.call, () => {});
  await expect(runner.submit(submission('first'), 'secret')).rejects.toThrow('Storage unavailable');
  expect(mocks.remote).not.toHaveBeenCalled();
});
it('persists a stranded storage failure before allowing explicit retry', async () => {
  const db = store();
  db.failFinish(2);
  const changed = vi.fn(),
    runner = new ReadingRunner(db.call, changed);
  await runner.submit(submission('first'), 'secret');
  await vi.waitFor(() =>
    expect(
      runner.decorateRun('passage', { id: 'first', status: 'saving' } as Passage['latest']).reason,
    ).toBe('save-failed'),
  );
  expect(db.rows.get('first')?.status).toBe('saving');
  const passage = {
    snapshot: submission('first').snapshot,
    latest: {
      id: 'first',
      status: 'saving',
      responseRaw: '',
      provider: 'openai-compatible',
      model: 'model',
      createdAt: 1,
    },
    bookmarked: false,
    unread: false,
  } satisfies Passage;
  expect(runner.decorate(passage).latest).toMatchObject({
    status: 'failed',
    responseRaw: 'Retained text',
    reason: 'save-failed',
  });
  await runner.submit(submission('retry'), 'secret');
  await vi.waitFor(() => expect(db.rows.get('retry')?.status).toBe('completed'));
  expect(db.rows.get('first')).toEqual({ status: 'failed', raw: 'Retained text' });
  expect(mocks.remote).toHaveBeenCalledTimes(2);
});
it('limits on-device work to one active request and Stop releases its queue', async () => {
  const db = store();
  let started = 0;
  mocks.local.mockImplementation(async function* (_config, _system, _user, signal: AbortSignal) {
    started++;
    yield { type: 'delta', text: 'Partial' };
    await new Promise<void>((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', () => resolve(), { once: true });
    });
  });
  // This test permits distinct passages in the store, so their queue isolation is observable.
  const call = (async (message: DbRequest) => {
    if (message.type === 'DB_SUBMIT') {
      const p = message.payload;
      db.rows.set(p.submissionId, { status: 'queued', raw: '' });
      return {
        passageId: p.snapshot.id,
        run: {
          id: p.submissionId,
          selectionId: p.snapshot.id,
          pageUrl: p.snapshot.page.url,
          input: p.input,
        },
      };
    }
    return db.call(message);
  }) as DbCall;
  const runner = new ReadingRunner(call, () => {});
  const a = submission('a'),
    b = submission('b');
  a.input.provider = b.input.provider = 'chrome-ai';
  b.snapshot.id = 'second';
  await runner.submit(a, '');
  await runner.submit(b, '');
  await vi.waitFor(() => expect(started).toBe(1));
  await runner.stop('passage');
  await vi.waitFor(() => expect(started).toBe(2));
  await runner.stop('second');
  await vi.waitFor(() => expect(db.rows.get('b')?.status).toBe('cancelled'));
});

afterEach(() => vi.useRealTimers());
it('flushes the tail of a fast burst while the provider is silent, then completes without Stop', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  let finish!: () => void;
  mocks.remote.mockImplementation(async function* () {
    yield { type: 'delta', text: 'A' };
    yield { type: 'delta', text: ' complete-looking answer.' };
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    yield { type: 'complete' };
  });
  const db = store();
  const changed = vi.fn();
  const runner = new ReadingRunner(db.call, changed);
  await runner.submit(submission('burst'), '');
  await vi.advanceTimersByTimeAsync(0);
  expect(db.rows.get('burst')).toEqual({ status: 'running', raw: 'A' });
  const notifications = changed.mock.calls.length;
  await vi.advanceTimersByTimeAsync(500);
  expect(db.rows.get('burst')).toEqual({ status: 'running', raw: 'A complete-looking answer.' });
  expect(changed.mock.calls.length).toBeGreaterThan(notifications);
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(db.rows.get('burst')?.status).toBe('completed');
  expect(vi.getTimerCount()).toBe(0);
});
it('cleans up a pending trailing flush on Stop and retains all received text', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  mocks.remote.mockImplementation(async function* (_config, _system, _user, signal: AbortSignal) {
    yield { type: 'delta', text: 'A' };
    yield { type: 'delta', text: ' partial answer' };
    await new Promise<void>((resolve) =>
      signal.addEventListener('abort', () => resolve(), { once: true }),
    );
  });
  const db = store();
  const runner = new ReadingRunner(db.call, () => {});
  await runner.submit(submission('stop'), '');
  await vi.advanceTimersByTimeAsync(0);
  await runner.stop('passage');
  await vi.advanceTimersByTimeAsync(0);
  expect(db.rows.get('stop')).toEqual({ status: 'cancelled', raw: 'A partial answer' });
  expect(vi.getTimerCount()).toBe(0);
});
it('exposes live provider activity without retaining reasoning or regressing after answer text', async () => {
  let resume!: () => void;
  const hold = () =>
    new Promise<void>((resolve) => {
      resume = resolve;
    });
  mocks.remote.mockImplementation(async function* () {
    await hold();
    yield { type: 'activity', phase: 'thinking' };
    await hold();
    yield { type: 'delta', text: 'Answer' };
    yield { type: 'activity', phase: 'thinking' };
    await hold();
    yield { type: 'complete' };
  });
  const db = store();
  const runner = new ReadingRunner(db.call, () => {});
  const current = () =>
    runner.decorateRun('passage', {
      id: 'activity',
      status: db.rows.get('activity')?.status,
    } as Passage['latest']);
  await runner.submit(submission('activity'), '');
  await vi.waitFor(() => expect(current().activity).toBe('connecting'));
  resume();
  await vi.waitFor(() => expect(current().activity).toBe('thinking'));
  resume();
  await vi.waitFor(() => expect(db.rows.get('activity')?.raw).toBe('Answer'));
  expect(current().activity).toBe('generating');
  resume();
  await vi.waitFor(() => expect(current().status).toBe('completed'));
  expect(current().activity).toBeUndefined();
});
