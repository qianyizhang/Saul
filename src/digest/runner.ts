import type { DbCall } from '../types/storage';
import { planEvents } from '../models/chatgpt-plan';
import { parseSummary } from './summary';
import {
  activeItem,
  type DigestBatch,
  type DigestItem,
  type DigestRequest,
  type DigestSource,
} from './types';

type Capture = (item: DigestItem) => Promise<DigestSource>;
export class DigestRunner {
  readonly ready: Promise<void>;
  private batch?: DigestBatch;
  private task?: Promise<void>;
  private controller?: AbortController;
  private controls: Promise<unknown> = Promise.resolve();
  constructor(
    private db: DbCall,
    private capture: Capture,
    private generate = planEvents,
  ) {
    this.ready = db({ type: 'DB_DIGEST_RECOVER', payload: undefined });
  }
  // Serialize control actions; generation itself stays independent of popup lifetime.
  request(request: DigestRequest, snapshot?: DigestBatch): Promise<unknown> {
    const action = this.controls.then(() => this.handle(request, snapshot));
    this.controls = action.catch(() => undefined);
    return action;
  }
  private async handle(r: DigestRequest, snapshot?: DigestBatch): Promise<unknown> {
    await this.ready;
    if (r.action === 'active') return this.task ? structuredClone(this.batch) : undefined;
    if (r.action === 'list') return this.db({ type: 'DB_DIGEST_LIST', payload: undefined });
    if (r.action === 'get')
      return structuredClone(
        this.batch?.id === r.id
          ? this.batch
          : await this.db({ type: 'DB_DIGEST_GET', payload: { id: r.id } }),
      );
    if (r.action === 'stop') {
      if (this.batch?.id === r.id) {
        this.controller?.abort();
        await this.task;
      }
      return this.handle({ action: 'get', id: r.id });
    }
    if (r.action === 'delete') {
      await this.handle({ action: 'stop', id: r.id });
      await this.db({ type: 'DB_DIGEST_DELETE', payload: { id: r.id } });
      if (this.batch?.id === r.id) this.batch = undefined;
      return;
    }
    if (this.task)
      throw new Error('A summary is already running. Stop it or wait for it to finish.');
    let batch: DigestBatch;
    if (r.action === 'start') {
      if (!snapshot) throw new Error('Missing selection snapshot.');
      batch = await this.db({ type: 'DB_DIGEST_CREATE', payload: snapshot });
      // Duplicate start IDs never regenerate completed or interrupted work.
      if (!batch.items.some((i) => i.status === 'queued')) return batch;
    } else {
      batch = await this.db({ type: 'DB_DIGEST_GET', payload: { id: r.id } });
      for (const item of batch.items)
        if (
          ['failed', 'interrupted', 'cancelled', 'queued', 'capturing', 'running'].includes(
            item.status,
          )
        ) {
          item.status = 'queued';
          item.raw = '';
          delete item.error;
          delete item.summary;
          await this.save(batch, item);
        }
    }
    this.batch = batch;
    const controller = new AbortController();
    this.controller = controller;
    this.task = this.run(batch, controller)
      .catch((error) => {
        batch.error =
          'Saving progress failed; processing stopped. ' +
          String(error instanceof Error ? error.message : error);
        for (const item of batch.items)
          if (activeItem(item)) {
            item.status = 'interrupted';
            item.error = batch.error;
          }
      })
      .finally(() => {
        this.task = undefined;
        this.controller = undefined;
      });
    return structuredClone(batch);
  }
  private save(batch: DigestBatch, item: DigestItem, source?: DigestSource) {
    return this.db({
      type: 'DB_DIGEST_ITEM',
      payload: { id: batch.id, item: { ...item }, source },
    }).catch((error: unknown) => {
      item.status = 'interrupted';
      item.error = 'Progress could not be saved.';
      throw error;
    });
  }
  private async run(batch: DigestBatch, controller: AbortController) {
    const signal = controller.signal;
    const queue = batch.items.filter((i) => i.status === 'queued');
    let paused = false;
    const worker = async () => {
      while (!paused && !signal.aborted) {
        const item = queue.shift();
        if (!item) return;
        try {
          await this.process(batch, item, signal, () => {
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
        source = await this.capture(item);
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
    item.status = signal.aborted ? 'cancelled' : 'running';
    await this.save(batch, item, source);
    if (signal.aborted) return;
    let providerFailed = true;
    try {
      let complete = false;
      for await (const event of this.generate(
        {
          action: 'generate',
          accountId: batch.accountId,
          model: batch.model,
          effort: batch.effort,
          systemPrompt: batch.prompt,
          userPrompt: JSON.stringify({
            title: item.title,
            url: item.url,
            coverage: source.coverage,
            text: source.text,
          }),
        },
        signal,
      )) {
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
      if (providerFailed && !signal.aborted) pause();
    }
    await this.save(batch, item);
  }
}
