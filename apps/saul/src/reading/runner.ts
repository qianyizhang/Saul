import type { GeneratedImage } from '../models/images';
import type { DbCall, Passage, RunResult, QueuedRun, Submission } from '../types/storage';
import { streamModel } from '../models/provider';
import { type ModelActivity, type ModelEvent, IncompleteGeneration } from '../models/events';
import { TagStreamParser } from '../parser/tag-stream-parser';

type Task = QueuedRun & {
  credential: string;
  controller: AbortController;
  raw: string;
  image?: GeneratedImage;
  saving: boolean;
  activity: ModelActivity;
};
export class ReadingRunner {
  private tasks = new Map<string, Task>();
  private failures = new Map<
    string,
    { runId: string; raw: string; error: string; image?: GeneratedImage; latencyMs?: number }
  >();
  private savingImages = new Set<string>();
  private active = new Set<string>();
  private recovery?: Promise<void>;
  get ready(): Promise<void> {
    this.recovery ??= this.db({ type: 'DB_RECOVER', payload: undefined }).catch((error) => {
      this.recovery = undefined;
      throw error;
    });
    return this.recovery;
  }
  constructor(
    private db: DbCall,
    private changed: (url: string) => void,
  ) {
    void this.ready.catch(() => undefined);
  }
  async submit(submission: Submission, credential: string) {
    await this.ready;
    const failed = this.failures.get(submission.snapshot.id);
    if (failed?.image)
      throw new Error('Save or download the unsaved image before starting another attempt.');
    if (failed) {
      await this.db({
        type: 'DB_FINISH',
        payload: {
          runId: failed.runId,
          raw: failed.raw,
          status: 'failed',
          reason: 'save-failed',
          error: failed.error,
          latencyMs: 0,
        },
      });
      this.failures.delete(submission.snapshot.id);
    }
    const result = await this.db({ type: 'DB_SUBMIT', payload: submission });
    if (result.run) {
      this.failures.delete(result.passageId);
      this.tasks.set(result.run.id, {
        ...result.run,
        credential,
        controller: new AbortController(),
        raw: '',
        saving: false,
        activity: 'connecting',
      });
      this.changed(result.run.pageUrl);
      this.pump();
    }
    return { passageId: result.passageId, reused: !result.run };
  }
  private pump() {
    for (const task of this.tasks.values()) {
      if (this.active.has(task.id)) continue;
      const provider = task.input.provider;
      const count = [...this.active].filter(
        (id) => this.tasks.get(id)?.input.provider === provider,
      ).length;
      if (count >= 2) continue;
      this.active.add(task.id);
      void this.execute(task);
    }
  }
  private async execute(task: Task) {
    const started = Date.now(),
      signal = task.controller.signal;
    let stream: AsyncGenerator<ModelEvent> | undefined;
    try {
      if (signal.aborted || !(await this.db({ type: 'DB_CLAIM', payload: { runId: task.id } })))
        return;
      const input = task.input;
      this.changed(task.pageUrl);
      stream = streamModel(input, task.credential, signal);
      let completed = false,
        checkpoint = 0,
        savedRaw = '';
      let pending: Promise<IteratorResult<ModelEvent>> | undefined;
      while (!signal.aborted) {
        pending ??= stream.next();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let result: IteratorResult<ModelEvent> | undefined;
        try {
          // Flush the tail of a burst even if the provider sends nothing else.
          result = await Promise.race([
            pending,
            ...(task.raw !== savedRaw
              ? [
                  new Promise<undefined>((resolve) => {
                    timer = setTimeout(
                      () => resolve(undefined),
                      Math.max(0, 500 - (Date.now() - checkpoint)),
                    );
                  }),
                ]
              : []),
          ]);
        } finally {
          clearTimeout(timer);
        }
        if (signal.aborted) break;
        if (result) {
          pending = undefined;
          if (result.done) break;
          const event = result.value;
          if (event.type === 'image') task.image = event.image;
          if (event.type === 'complete') {
            completed = true;
            break;
          }
          const previous = task.activity;
          if (event.type === 'delta' && event.text) {
            task.raw += event.text;
            task.activity = 'generating';
          } else if (event.type === 'activity' && task.activity !== 'generating') {
            task.activity = event.phase;
          }
          if (previous !== task.activity) this.changed(task.pageUrl);
        }
        if (task.raw !== savedRaw && Date.now() - checkpoint >= 500) {
          await this.db({ type: 'DB_CHECKPOINT', payload: { runId: task.id, raw: task.raw } });
          savedRaw = task.raw;
          checkpoint = Date.now();
          this.changed(task.pageUrl);
        }
      }
      if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
      if (!completed)
        throw new IncompleteGeneration(
          'unexpected-eof',
          'Generation ended without a completion signal.',
        );
      if (
        !task.image &&
        !new TagStreamParser()
          .feed(task.raw)
          .some((s) => (s.type === 'text' ? s.text : s.term).trim())
      )
        throw new Error('The model returned no explanation. Check the model and endpoint.');
      if (task.image) await this.writeImage(task.id, task.image, signal);
      task.saving = true;
      if (!(await this.db({ type: 'DB_SAVING', payload: { runId: task.id } }))) return;
      this.changed(task.pageUrl);
      await this.db({
        type: 'DB_FINISH',
        payload: {
          runId: task.id,
          raw: task.raw,
          status: 'completed',
          latencyMs: Date.now() - started,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (task.image && !signal.aborted) {
        this.failures.set(task.selectionId, {
          runId: task.id,
          raw: task.raw,
          image: task.image,
          latencyMs: Date.now() - started,
          error: 'Image not saved. Download it or retry saving before closing Saul. ' + message,
        });
        return;
      }
      try {
        await this.db({
          type: 'DB_FINISH',
          payload: {
            runId: task.id,
            raw: task.raw,
            status: signal.aborted
              ? 'cancelled'
              : error instanceof IncompleteGeneration
                ? 'interrupted'
                : 'failed',
            reason: signal.aborted
              ? 'stopped'
              : error instanceof IncompleteGeneration
                ? error.reason
                : task.saving
                  ? 'save-failed'
                  : 'provider-error',
            error: signal.aborted ? 'Stopped. Partial explanation retained.' : message,
            latencyMs: Date.now() - started,
          },
        });
      } catch {
        this.failures.set(task.selectionId, {
          runId: task.id,
          raw: task.raw,
          error:
            'Could not save this attempt. Available text is shown here; retry after storage recovers. ' +
            message,
        });
      }
    } finally {
      task.controller.abort();
      await stream?.return(undefined).catch(() => {});
      task.credential = '';
      this.tasks.delete(task.id);
      this.active.delete(task.id);
      this.changed(task.pageUrl);
      this.pump();
    }
  }
  private async writeImage(runId: string, image: GeneratedImage, signal?: AbortSignal) {
    for (let offset = 0; offset < image.data.length; offset += 200_000) {
      signal?.throwIfAborted();
      await this.db({
        type: 'DB_IMAGE_CHUNK',
        payload: {
          runId,
          offset,
          data: image.data.slice(offset, offset + 200_000),
          mediaType: image.mediaType,
          last: offset + 200_000 >= image.data.length,
        },
      });
    }
  }
  unsavedImage(selectionId: string, runId: string) {
    const failure = this.failures.get(selectionId);
    return failure?.runId === runId ? failure.image : undefined;
  }
  async saveImage(selectionId: string) {
    const failure = this.failures.get(selectionId);
    if (!failure?.image || this.savingImages.has(selectionId))
      throw new Error('No unsaved image is ready to save.');
    this.savingImages.add(selectionId);
    try {
      const passage = await this.db({ type: 'DB_PASSAGE', payload: { selectionId } });
      if (passage?.latest.id !== failure.runId) throw new Error('The image attempt changed.');
      if (passage.latest.status !== 'completed') {
        await this.writeImage(failure.runId, failure.image);
        if (
          passage.latest.status !== 'saving' &&
          !(await this.db({ type: 'DB_SAVING', payload: { runId: failure.runId } }))
        )
          throw new Error('The image attempt is no longer available.');
        await this.db({
          type: 'DB_FINISH',
          payload: {
            runId: failure.runId,
            raw: failure.raw,
            status: 'completed',
            latencyMs: failure.latencyMs ?? 0,
          },
        });
        const saved = await this.db({ type: 'DB_PASSAGE', payload: { selectionId } });
        if (saved?.latest.id !== failure.runId || saved.latest.status !== 'completed')
          throw new Error('The image could not be saved.');
      }
      this.failures.delete(selectionId);
    } finally {
      this.savingImages.delete(selectionId);
      this.changed('*');
    }
  }
  async stop(selectionId: string) {
    await this.ready;
    for (const task of this.tasks.values()) {
      if (task.selectionId !== selectionId || task.saving) continue;
      task.controller.abort();
      if (!this.active.has(task.id)) {
        this.tasks.delete(task.id);
        task.credential = '';
        await this.db({
          type: 'DB_FINISH',
          payload: {
            runId: task.id,
            raw: task.raw,
            status: 'cancelled',
            reason: 'stopped',
            error: 'Stopped before generation.',
            latencyMs: 0,
          },
        });
        this.changed(task.pageUrl);
      }
    }
    this.pump();
  }
  async remove(selectionId?: string) {
    await this.ready;
    // Delete first: foreign keys and conditional writes make every late event inert.
    await this.db(
      selectionId
        ? { type: 'DB_DELETE_SELECTION', payload: { selectionId } }
        : { type: 'DB_CLEAR_HISTORY', payload: undefined },
    );
    for (const task of this.tasks.values())
      if (!selectionId || task.selectionId === selectionId) {
        task.controller.abort();
        if (!this.active.has(task.id)) this.tasks.delete(task.id);
      }
    if (selectionId) this.failures.delete(selectionId);
    else this.failures.clear();
    this.changed('*');
    this.pump();
  }
  decorateRun(selectionId: string, run: RunResult): RunResult {
    const task = this.tasks.get(run.id);
    if (task && run.status === 'running') run = { ...run, activity: task.activity };
    const failed = this.failures.get(selectionId);
    if (failed?.runId === run.id && run.status === 'completed') this.failures.delete(selectionId);
    return failed?.runId === run.id && ['queued', 'running', 'saving'].includes(run.status)
      ? {
          ...run,
          status: 'failed',
          responseRaw: failed.raw,
          error: failed.error,
          reason: 'save-failed',
          hasImage: !!failed.image,
        }
      : run;
  }
  decorate(passage: Passage): Passage {
    return { ...passage, latest: this.decorateRun(passage.snapshot.id, passage.latest) };
  }
}
