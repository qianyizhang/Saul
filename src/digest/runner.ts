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
      throw new Error('A digest is already running. Stop it or wait for it to finish.');
    let batch: DigestBatch;
    if (r.action === 'start') {
      if (!snapshot) throw new Error('Missing window snapshot.');
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
    this.task = this.run(batch, controller.signal)
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
    });
  }
  private async run(batch: DigestBatch, signal: AbortSignal) {
    // One request at a time: bounded quota use and immediate stop before the next tab.
    for (const item of batch.items) {
      if (item.status !== 'queued') continue;
      if (signal.aborted) {
        item.status = 'cancelled';
        await this.save(batch, item);
        continue;
      }
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
          continue;
        }
      }
      item.coverage = source.coverage;
      item.truncated = source.truncated;
      item.capturedAt = source.capturedAt;
      item.status = signal.aborted ? 'cancelled' : 'running';
      await this.save(batch, item, source);
      if (signal.aborted) continue;
      let providerFailed = false;
      try {
        let complete = false;
        providerFailed = true;
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
      }
      await this.save(batch, item);
      if (providerFailed && !signal.aborted) {
        for (const pending of batch.items)
          if (pending.status === 'queued') {
            pending.status = 'interrupted';
            pending.error = 'Paused after a provider failure. Retry unfinished tabs explicitly.';
            await this.save(batch, pending);
          }
        return;
      }
    }
  }
}
