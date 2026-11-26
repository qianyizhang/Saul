import type { DbCall } from '../../../shared/protocol/history-types.ts';
import { type CallSnapshot } from '../../../shared/model/call-output.ts';
import {
  createCallExecutor,
  type CallExecutor,
  type CallOutcome,
  type FrozenCall,
} from './executor';
import { executionModel, originalSummaryPlan } from '../../../shared/model/execution-route.ts';
import { SUMMARY_PROMPT } from './summary';
import { compareText } from '../../../shared/model/text-change.ts';
import {
  activeItem,
  interruptItem,
  retryableItem,
  type DigestBatch,
  type CallLookup,
  type DigestItem,
  type DigestRequest,
  type DigestSource,
  type DigestComparison,
  type DigestInspection,
  type PdfProcessing,
} from '../../../shared/model/call-batch.ts';

type Capture = (
  item: DigestItem,
  signal?: AbortSignal,
  pdfProcessing?: PdfProcessing,
) => Promise<DigestSource>;
interface ActiveCallBatch {
  batch: DigestBatch;
  controller: AbortController;
  task: Promise<void>;
}
const sourceBusy =
  'A summary is already running for one of these pages. Stop it or wait for it to finish.';

export class CallBatchRunner {
  private recovery?: Promise<void>;
  private runs = new Map<string, ActiveCallBatch>();
  // A storage outage can leave an active row behind after its task has stopped.
  // Keep only its notice; the durable row remains the only saved result.
  private writeFailures = new Map<string, string>();
  private controls: Promise<unknown> = Promise.resolve();
  constructor(
    private db: DbCall,
    private capture: Capture,
    private executor: CallExecutor = createCallExecutor(),
  ) {
    void this.recover().catch(() => undefined);
  }
  private recover() {
    this.recovery ??= this.db({ type: 'DB_DIGEST_RECOVER', payload: undefined }).catch((error) => {
      this.recovery = undefined;
      throw error;
    });
    return this.recovery;
  }
  // Serialize control actions; generation itself stays independent of popup lifetime.
  request(
    request: DigestRequest,
    snapshot?: DigestBatch | CallLookup,
    credential = '',
  ): Promise<unknown> {
    // Read-only page comparisons must not delay Stop or other generation controls.
    if (
      request.action === 'resolve' ||
      request.action === 'inspect' ||
      request.action === 'active' ||
      request.action === 'list' ||
      request.action === 'get'
    )
      return this.handle(request, snapshot);
    if (request.action === 'stop')
      return this.enqueue(async () => {
        await this.recover();
        return this.abort(request.id);
      }).then(async (run) => {
        // Settling one run must not delay control actions on unrelated sources.
        if (!run) return this.handle({ action: 'get', id: request.id });
        await run.task;
        return structuredClone(run.batch);
      });
    return this.enqueue(() => this.handle(request, snapshot, credential));
  }
  private enqueue<T>(control: () => Promise<T>): Promise<T> {
    const action = this.controls.then(control);
    this.controls = action.catch(() => undefined);
    return action;
  }
  private abort(id: string): ActiveCallBatch | undefined {
    const run = this.runs.get(id);
    run?.controller.abort();
    return run;
  }
  private async handle(
    r: Exclude<DigestRequest, { action: 'stop' }>,
    snapshot?: DigestBatch | CallLookup,
    credential = '',
  ): Promise<unknown> {
    await this.recover();
    if (r.action === 'active') return structuredClone([...this.runs.values()].at(-1)?.batch);
    if (r.action === 'inspect') {
      const batch = await this.db({ type: 'DB_DIGEST_GET', payload: { id: r.id } });
      const item = batch.items.find(({ index }) => index === r.index);
      if (!item) throw new Error('This summary source does not exist.');
      return this.inspect(batch, item, r.tabId);
    }
    if (r.action === 'resolve') {
      if (!snapshot) throw new Error('Missing selection snapshot.');
      const batch = await this.find(snapshot);
      if (!batch) return { comparisons: [] };
      const comparisons: DigestComparison[] = [];
      const savedItems = new Map(batch.items.map((item) => [item.index, item]));
      let modelChange: string | undefined;
      if ('currentModel' in snapshot) {
        const saved = batch.action?.input ?? batch.summaryInput;
        try {
          const original = saved ? executionModel(saved) : originalSummaryPlan(batch);
          if (!snapshot.currentModel) modelChange = 'Current model preset unavailable';
          else if (
            saved?.preset?.id !== snapshot.currentModel.preset?.id ||
            JSON.stringify(original) !== JSON.stringify(executionModel(snapshot.currentModel))
          )
            modelChange = 'Model settings';
        } catch {
          modelChange = 'Model settings unavailable';
        }
      }
      // Limit capture concurrency and discard current text after measuring it.
      const queue = [...snapshot.items];
      const compare = async () => {
        for (let item = queue.shift(); item; item = queue.shift()) {
          const saved = savedItems.get(item.index);
          if (!saved) {
            comparisons.push({
              index: item.index,
              fields: [],
              error: 'The saved source is unavailable.',
            });
            continue;
          }
          const inspected = await this.inspect(
            batch,
            saved,
            item.tabId,
            item,
            snapshot.pdfProcessing ?? batch.pdfProcessing ?? 'local',
          );
          const comparison = inspected.comparison!;
          if (modelChange) comparison.fields.push(modelChange);
          comparisons.push(comparison);
        }
      };
      await Promise.all([compare(), compare()]);
      return {
        batch: structuredClone(batch),
        comparisons: comparisons.sort((a, b) => a.index - b.index),
      };
    }
    if (r.action === 'list') return this.db({ type: 'DB_DIGEST_LIST', payload: undefined });
    if (r.action === 'get') {
      const running = this.runs.get(r.id);
      if (running) return structuredClone(running.batch);
      const batch = await this.db({ type: 'DB_DIGEST_GET', payload: { id: r.id } });
      const error = this.writeFailures.get(r.id);
      if (!error || !batch.items.some(activeItem)) return batch;
      return {
        ...batch,
        error,
        items: batch.items.map((item) => (activeItem(item) ? interruptItem(item, error) : item)),
      };
    }
    if (r.action === 'delete') {
      const run = this.abort(r.id);
      if (run) await run.task;
      await this.db({ type: 'DB_DIGEST_DELETE', payload: { id: r.id } });
      this.writeFailures.delete(r.id);
      return;
    }
    if (r.action === 'start' && !r.regenerate && snapshot) {
      const cached = await this.find(snapshot);
      if (cached) return structuredClone(cached);
    }
    let batch: DigestBatch;
    if (r.action === 'start') {
      if (!snapshot || !('createdAt' in snapshot)) throw new Error('Missing frozen Call.');
      const existing = this.runs.get(r.id)?.batch;
      if (existing) return structuredClone(existing);
      if (this.writeFailures.has(r.id)) return this.handle({ action: 'get', id: r.id });
      this.checkSources(snapshot.items.filter(activeItem));
      batch = await this.db({ type: 'DB_DIGEST_CREATE', payload: snapshot });
      // Duplicate start IDs never regenerate completed or interrupted work.
      if (!batch.items.some((i) => i.status === 'queued')) return batch;
    } else {
      if (this.runs.has(r.id)) throw new Error(sourceBusy);
      batch = await this.db({ type: 'DB_DIGEST_GET', payload: { id: r.id } });
      this.checkSources(batch.items.filter(retryableItem));
      batch = await this.db({ type: 'DB_DIGEST_RETRY', payload: { id: r.id } });
    }
    this.writeFailures.delete(batch.id);
    const controller = new AbortController();
    const task = this.run(batch, controller, credential)
      .catch(async (cause: unknown) => {
        const error =
          'Could not save summary progress; processing stopped. ' +
          (cause instanceof Error ? cause.message : String(cause));
        try {
          // Do not replace a completed row if the save committed but its reply was lost.
          Object.assign(
            batch,
            await this.db({
              type: 'DB_DIGEST_INTERRUPT',
              payload: { id: batch.id, error },
            }),
          );
        } catch {
          this.writeFailures.set(batch.id, error);
          batch.error = error;
          batch.items = batch.items.map((item) =>
            activeItem(item) ? interruptItem(item, error) : item,
          );
        }
      })
      .finally(() => {
        this.runs.delete(batch.id);
      });
    this.runs.set(batch.id, { batch, controller, task });
    return structuredClone(batch);
  }
  private checkSources(items: DigestItem[]) {
    const urls = new Set(items.map((item) => item.url));
    for (const { batch } of this.runs.values())
      if (batch.items.some((item) => activeItem(item) && urls.has(item.url)))
        throw new Error(sourceBusy);
  }
  private async find(snapshot: CallLookup): Promise<DigestBatch | undefined> {
    const urls = snapshot.items.map((item) => item.url);
    for (const { batch } of this.runs.values())
      if (
        batch.action?.revision.revision === snapshot.action?.revision.revision &&
        batch.action?.presetId === snapshot.action?.presetId &&
        batch.items.length === urls.length &&
        batch.items.every((item, index) => item.url === urls[index])
      )
        return batch;
    return this.db({
      type: 'DB_DIGEST_FIND',
      payload: {
        urls,
        ...(snapshot.action
          ? {
              actionRevision: snapshot.action.revision.revision,
              actionPresetId: snapshot.action.presetId,
            }
          : {}),
      },
    });
  }
  private async inspect(
    batch: DigestBatch,
    item: DigestItem,
    tabId?: number,
    currentItem?: DigestItem,
    currentProcessing = batch.pdfProcessing ?? 'local',
  ): Promise<DigestInspection> {
    const saved = await this.db({
      type: 'DB_DIGEST_SOURCE',
      payload: { id: batch.id, index: item.index },
    });
    if (tabId === undefined) return { saved };
    const comparison: DigestComparison = { index: item.index, fields: [] };
    if (!batch.action && batch.prompt !== SUMMARY_PROMPT) comparison.fields.push('Instructions');
    if (currentItem && currentItem.title !== item.title) comparison.fields.push('Page title');
    try {
      const current = await this.capture({ ...item, tabId }, undefined, currentProcessing);
      comparison.checkedAt = current.capturedAt;
      if (
        current.title !== undefined &&
        current.title !== item.title &&
        !comparison.fields.includes('Page title')
      )
        comparison.fields.push('Page title');
      if (saved) {
        if (
          (saved.kind === 'pdf-url' || current.kind === 'pdf-url') &&
          (batch.pdfProcessing ?? 'local') !== currentProcessing
        )
          comparison.fields.push('PDF processing');
        if (saved.kind === 'pdf-url' || current.kind === 'pdf-url') {
          comparison.notice =
            'PDF contents not compared. URL attachments are read by OpenAI during generation; a matching URL does not prove unchanged contents.';
        } else comparison.text = compareText(saved.text, current.text);
        if (saved.coverage !== current.coverage || saved.truncated !== current.truncated)
          comparison.fields.push('Source coverage');
      } else comparison.error = 'The original source input is unavailable.';
      return { saved, current, comparison };
    } catch (error) {
      comparison.error = error instanceof Error ? error.message : String(error);
      return { saved, comparison };
    }
  }
  private save(batch: DigestBatch, item: DigestItem, source?: DigestSource) {
    return this.db({
      type: 'DB_DIGEST_ITEM',
      payload: { id: batch.id, item: { ...item }, source },
    });
  }
  private async run(batch: DigestBatch, controller: AbortController, credential: string) {
    const signal = controller.signal;
    const queue = batch.items.filter((i) => i.status === 'queued');
    let paused = false;
    const worker = async () => {
      while (!paused && !signal.aborted) {
        const item = queue.shift();
        if (!item) return;
        try {
          await this.process(batch, item, signal, credential, () => {
            paused = true;
          });
        } catch (error) {
          controller.abort();
          throw error;
        }
      }
    };
    // Wait for both streams before releasing delete/retry/new-start controls.
    const results = await Promise.allSettled([worker(), worker()]);
    const failed = results.find((r) => r.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    for (const item of queue) {
      item.status = signal.aborted ? 'cancelled' : 'interrupted';
      item.error = signal.aborted
        ? 'Stopped.'
        : 'Paused after a provider failure. Retry unfinished tabs explicitly.';
      await this.save(batch, item);
    }
  }
  private async process(
    batch: DigestBatch,
    item: DigestItem,
    signal: AbortSignal,
    credential: string,
    pause: () => void,
  ) {
    item.status = 'capturing';
    await this.save(batch, item);
    let source = await this.db({
      type: 'DB_DIGEST_SOURCE',
      payload: { id: batch.id, index: item.index },
    });
    if (!source) {
      try {
        signal.throwIfAborted();
        source = await this.capture(item, signal, batch.pdfProcessing ?? 'local');
      } catch (error) {
        item.status = signal.aborted ? 'cancelled' : 'failed';
        item.error = String(error instanceof Error ? error.message : error);
        await this.save(batch, item);
        return;
      }
    }
    item.coverage = source.coverage;
    item.truncated = source.truncated;
    item.capturedAt = source.capturedAt;
    if (source.kind === 'pdf-url') item.sourceKind = 'pdf-url';
    else delete item.sourceKind;
    item.status = signal.aborted ? 'cancelled' : 'running';
    await this.save(batch, item, source);
    if (signal.aborted) return;
    // Translate the existing saved representation; selection remains admission-owned.
    const call: FrozenCall = batch.action
      ? { kind: 'script', revision: batch.action.revision.revision, input: batch.action.input }
      : {
          kind: 'summarize',
          instructions: batch.prompt,
          model: batch.summaryInput
            ? { kind: 'preset', input: batch.summaryInput }
            : {
                kind: 'plan',
                accountId: batch.accountId,
                model: batch.model,
                effort: batch.effort,
                credentialOwner: batch.credentialOwner ?? 'local',
                connectionKey: batch.connectionKey,
              },
        };
    const project = (output: CallSnapshot) => {
      item.raw = output.raw;
      if (output.calls) item.calls = output.calls;
      else delete item.calls;
      if (output.progress !== undefined) item.progress = output.progress;
      else delete item.progress;
    };
    const controller = new AbortController();
    const executionSignal = AbortSignal.any([signal, controller.signal]);
    let pending: Promise<void> | undefined;
    let saveError: unknown;
    // Preserve custom Call checkpoints; built-in Summarize still saves only at completion.
    const timer = batch.action
      ? setInterval(() => {
          if (pending || saveError) return;
          pending = this.save(batch, item)
            .catch((error: unknown) => {
              saveError = error;
              controller.abort();
            })
            .finally(() => {
              pending = undefined;
            });
        }, 500)
      : undefined;
    let outcome: CallOutcome;
    try {
      outcome = await this.executor.execute(
        { call, page: { title: item.title, url: item.url, source } },
        { credential, signal: executionSignal, onProgress: project },
      );
      // Keep the item in a live saving phase until the final row commits.
      if (!saveError) item.status = 'saving';
      // Stop admitting siblings before waiting for a slow outstanding checkpoint.
      if (outcome.kind === 'failed' && outcome.failure === 'execution') pause();
    } finally {
      clearInterval(timer);
      await pending;
      delete item.progress;
    }
    if (saveError) throw saveError;
    project(outcome.output);
    const terminal = { ...item };
    if (outcome.kind === 'completed') {
      terminal.status = 'completed';
      if (outcome.result.kind === 'summary') terminal.summary = outcome.result.summary;
      else terminal.finalText = outcome.result.text;
    } else {
      terminal.status = outcome.kind === 'cancelled' ? 'cancelled' : 'failed';
      terminal.error = outcome.message;
    }
    delete terminal.progress;
    await this.save(batch, terminal);
    Object.assign(item, terminal);
  }
}
