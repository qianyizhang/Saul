import type { DbCall } from '../types/storage';
import { planEvents } from '../models/chatgpt-plan';
import { streamModel } from '../models/provider';
import { parseSummary, SUMMARY_PROMPT, summaryRequestInput } from './summary';
import { compareText } from '../reading/input-change';
import { runCustomAction } from '../actions/run';
import {
  activeItem,
  type DigestBatch,
  type DigestItem,
  type DigestRequest,
  type DigestSource,
  type DigestComparison,
  type DigestInspection,
  type PdfProcessing,
} from './types';

type Capture = (
  item: DigestItem,
  signal?: AbortSignal,
  pdfProcessing?: PdfProcessing,
) => Promise<DigestSource>;
interface DigestRun {
  batch: DigestBatch;
  controller: AbortController;
  task: Promise<void>;
}
const sourceBusy =
  'A summary is already running for one of these pages. Stop it or wait for it to finish.';

export class DigestRunner {
  readonly ready: Promise<void>;
  private runs = new Map<string, DigestRun>();
  // A failed save cannot record its own interruption in SQLite.
  private interrupted = new Map<string, DigestBatch>();
  private controls: Promise<unknown> = Promise.resolve();
  constructor(
    private db: DbCall,
    private capture: Capture,
    private generate = planEvents,
    private custom = runCustomAction,
  ) {
    this.ready = db({ type: 'DB_DIGEST_RECOVER', payload: undefined });
  }
  // Serialize control actions; generation itself stays independent of popup lifetime.
  request(request: DigestRequest, snapshot?: DigestBatch, credential = ''): Promise<unknown> {
    // Read-only page comparisons must not delay Stop or other generation controls.
    if (request.action === 'resolve' || request.action === 'inspect')
      return this.ready.then(() => this.handle(request, snapshot));
    if (request.action === 'stop')
      return this.enqueue(async () => {
        await this.ready;
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
  private abort(id: string): DigestRun | undefined {
    const run = this.runs.get(id);
    run?.controller.abort();
    return run;
  }
  private async handle(
    r: Exclude<DigestRequest, { action: 'stop' }>,
    snapshot?: DigestBatch,
    credential = '',
  ): Promise<unknown> {
    await this.ready;
    if (r.action === 'active') return structuredClone([...this.runs.values()].at(-1)?.batch);
    if (r.action === 'inspect') {
      const batch = await this.db({ type: 'DB_DIGEST_GET', payload: { id: r.id } });
      const item = batch.items[r.index];
      if (!item) throw new Error('This summary source does not exist.');
      return this.inspect(batch, item, r.tabId);
    }
    if (r.action === 'resolve') {
      if (!snapshot) throw new Error('Missing selection snapshot.');
      const batch = await this.find(snapshot);
      if (!batch) return { comparisons: [] };
      const comparisons: DigestComparison[] = [];
      // Limit capture concurrency and discard current text after measuring it.
      const queue = [...snapshot.items];
      const compare = async () => {
        for (let item = queue.shift(); item; item = queue.shift()) {
          const inspected = await this.inspect(
            batch,
            batch.items[item.index]!,
            item.tabId,
            item,
            snapshot.pdfProcessing ?? batch.pdfProcessing ?? 'local',
          );
          comparisons[item.index] = inspected.comparison!;
        }
      };
      await Promise.all([compare(), compare()]);
      return { batch: structuredClone(batch), comparisons };
    }
    if (r.action === 'list') return this.db({ type: 'DB_DIGEST_LIST', payload: undefined });
    if (r.action === 'get')
      return structuredClone(
        this.runs.get(r.id)?.batch ??
          this.interrupted.get(r.id) ??
          (await this.db({ type: 'DB_DIGEST_GET', payload: { id: r.id } })),
      );
    if (r.action === 'delete') {
      const run = this.abort(r.id);
      if (run) await run.task;
      else await this.handle({ action: 'get', id: r.id });
      await this.db({ type: 'DB_DIGEST_DELETE', payload: { id: r.id } });
      this.interrupted.delete(r.id);
      return;
    }
    if (r.action === 'start' && !r.regenerate && snapshot) {
      const cached = await this.find(snapshot);
      if (cached) return structuredClone(cached);
    }
    let batch: DigestBatch;
    if (r.action === 'start') {
      if (!snapshot) throw new Error('Missing selection snapshot.');
      const existing = this.runs.get(r.id)?.batch ?? this.interrupted.get(r.id);
      if (existing) return structuredClone(existing);
      this.checkSources(snapshot.items.filter(activeItem));
      batch = await this.db({ type: 'DB_DIGEST_CREATE', payload: snapshot });
      // Duplicate start IDs never regenerate completed or interrupted work.
      if (!batch.items.some((i) => i.status === 'queued')) return batch;
    } else {
      if (this.runs.has(r.id)) throw new Error(sourceBusy);
      batch = await this.db({ type: 'DB_DIGEST_GET', payload: { id: r.id } });
      const unfinished = batch.items.filter(
        (item) => activeItem(item) || ['failed', 'interrupted', 'cancelled'].includes(item.status),
      );
      this.checkSources(unfinished);
      for (const item of unfinished) {
        item.status = 'queued';
        item.raw = '';
        delete item.error;
        delete item.summary;
        delete item.finalText;
        delete item.calls;
        delete item.progress;
        await this.save(batch, item);
      }
    }
    this.interrupted.delete(batch.id);
    const controller = new AbortController();
    const task = this.run(batch, controller, credential)
      .catch((error) => {
        batch.error =
          'Saving progress failed; processing stopped. ' +
          String(error instanceof Error ? error.message : error);
        for (const item of batch.items)
          if (activeItem(item)) {
            item.status = 'interrupted';
            item.error = batch.error;
            delete item.finalText;
            delete item.summary;
          }
        this.interrupted.set(batch.id, batch);
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
  private async find(snapshot: DigestBatch): Promise<DigestBatch | undefined> {
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
    if (
      !batch.action &&
      !batch.summaryInput &&
      (batch.model !== 'gpt-6-luna' || batch.effort !== 'medium')
    )
      comparison.fields.push('Model settings');
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
    }).catch((error: unknown) => {
      item.status = 'interrupted';
      item.error = 'Progress could not be saved.';
      delete item.finalText;
      delete item.summary;
      throw error;
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
    if (batch.action) {
      const controller = new AbortController();
      const actionSignal = AbortSignal.any([signal, controller.signal]);
      let pending: Promise<void> | undefined;
      let saveError: unknown;
      const timer = setInterval(() => {
        if (pending || saveError) return;
        pending = this.save(batch, item)
          .catch((error: unknown) => {
            saveError = error;
            controller.abort();
          })
          .finally(() => {
            pending = undefined;
          });
      }, 500);
      let text: string | undefined;
      try {
        text = await this.custom(batch, item, source, credential, actionSignal);
        actionSignal.throwIfAborted();
      } catch (error) {
        item.status = signal.aborted ? 'cancelled' : 'failed';
        item.error = error instanceof Error ? error.message : String(error);
        if (!signal.aborted) pause();
      } finally {
        clearInterval(timer);
        await pending;
        delete item.progress;
      }
      if (saveError) throw saveError;
      if (text !== undefined) {
        item.finalText = text;
        item.status = 'completed';
      }
      await this.save(batch, item);
      return;
    }
    let providerFailed = true;
    try {
      let complete = false;
      const { userPrompt, attachments } = summaryRequestInput(item, source);
      const events = batch.summaryInput
        ? streamModel(
            { ...batch.summaryInput, systemPrompt: batch.prompt, userPrompt },
            credential,
            signal,
            { attachments },
          )
        : this.generate(
            {
              action: 'generate',
              accountId: batch.accountId,
              model: batch.model,
              effort: batch.effort,
              systemPrompt: batch.prompt,
              userPrompt,
              ...(attachments ? { attachments } : {}),
            },
            signal,
            batch.credentialOwner ?? 'local',
          );
      for await (const event of events) {
        if (event.type === 'delta') {
          item.raw += event.text;
          if (item.raw.length > 30000) throw new Error('Summary exceeded the output limit.');
        }
        if (event.type === 'complete') complete = true;
      }
      signal.throwIfAborted();
      if (!complete) throw new Error('Generation ended without a completed response.');
      providerFailed = false;
      item.summary = parseSummary(item.raw);
      item.status = 'completed';
    } catch (error) {
      item.status = signal.aborted ? 'cancelled' : 'failed';
      item.error = String(error instanceof Error ? error.message : error);
      if (
        source.kind === 'pdf-url' &&
        providerFailed &&
        !signal.aborted &&
        (!batch.summaryInput || batch.summaryInput.provider === 'chatgpt-plan')
      )
        item.error +=
          ' PDF URL attachment failed; OpenAI must be able to fetch the URL and the model must support PDF input. No local fallback was used. Choose Local PDF processing in Settings and Run again to send extracted text instead.';
      if (providerFailed && !signal.aborted) pause();
    }
    await this.save(batch, item);
  }
}
