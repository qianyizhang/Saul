import type { GeneratedImage } from '../../shared/model/image.ts';
import type {
  DbCall,
  DbOperations,
  DbRequest,
  DbType,
  Passage,
  RunResult,
  QueuedRun,
  Submission,
} from '../../shared/protocol/history-types.ts';
import { streamModel } from '../providers/stream';
import {
  type ModelActivity,
  type ModelEvent,
  IncompleteGeneration,
} from '../../shared/model/model-events.ts';
import { TagStreamParser } from '../../shared/model/tag-stream-parser.ts';

type ReadingQuery =
  | 'DB_GET_HISTORY'
  | 'DB_RUNS'
  | 'DB_PAGE'
  | 'DB_PASSAGE'
  | 'DB_CONTEXT'
  | 'DB_INPUT'
  | 'DB_IMAGE'
  | 'DB_UNREAD'
  | 'DB_EXPORT_MARKDOWN';

type ReadingAttempt = QueuedRun & {
  credential: string;
  controller: AbortController;
  phase: 'queued' | 'generating' | 'saving' | 'settling';
  discarded?: true;
  activity: ModelActivity;
};
type WriteFailure = { runId: string; error: string; latencyMs: number };

class ReadingWriteError extends Error {
  constructor(cause: unknown) {
    super(
      'Could not save this attempt. ' + (cause instanceof Error ? cause.message : String(cause)),
    );
  }
}

export class ReadingRunner {
  private attempts = new Map<string, ReadingAttempt>();
  // Only a failure notice can outlive execution. Output is read from SQLite.
  private stranded = new Map<string, WriteFailure>();
  private controls: Promise<unknown> = Promise.resolve();
  private recovery?: Promise<void>;
  private recover(): Promise<void> {
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
    void this.recover().catch(() => undefined);
  }
  private control<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.controls.then(async () => {
      await this.recover();
      return operation();
    });
    this.controls = next.catch(() => undefined);
    return next;
  }
  submit(submission: Submission, credential: string) {
    return this.control(async () => {
      const selectionId = submission.snapshot.id;
      const failed = this.stranded.get(selectionId);
      if (failed) {
        // An explicit new run may settle the stale active row before admission.
        // The conditional write cannot change a completed or deleted run.
        await this.db({
          type: 'DB_FINISH',
          payload: { ...failed, status: 'failed', reason: 'save-failed' },
        });
        this.stranded.delete(selectionId);
      }
      const result = await this.db({ type: 'DB_SUBMIT', payload: submission });
      if (result.run) {
        this.attempts.set(result.run.id, {
          ...result.run,
          credential,
          controller: new AbortController(),
          phase: 'queued',
          activity: 'connecting',
        });
        this.changed(result.run.pageUrl);
        this.pump();
      }
      return { passageId: result.passageId, reused: !result.run };
    });
  }
  private pump() {
    for (const attempt of this.attempts.values()) {
      if (attempt.phase !== 'queued') continue;
      const count = [...this.attempts.values()].filter(
        (a) => a.phase !== 'queued' && a.input.provider === attempt.input.provider,
      ).length;
      if (count >= 2) continue;
      attempt.phase = 'generating';
      void this.execute(attempt);
    }
  }
  private async write<K extends DbType>(message: DbRequest<K>) {
    try {
      return await this.db(message);
    } catch (cause) {
      throw new ReadingWriteError(cause);
    }
  }
  private async execute(task: ReadingAttempt) {
    const started = performance.now(),
      signal = task.controller.signal;
    let stream: AsyncGenerator<ModelEvent> | undefined;
    let raw = '';
    let image: GeneratedImage | undefined;
    try {
      if (!(await this.write({ type: 'DB_CLAIM', payload: { runId: task.id } }))) return;
      signal.throwIfAborted();
      const input = task.input;
      this.changed(task.pageUrl);
      stream = streamModel(input, task.credential, signal);
      let completed = false,
        checkpoint = -Infinity,
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
            ...(raw !== savedRaw
              ? [
                  new Promise<undefined>((resolve) => {
                    timer = setTimeout(
                      () => resolve(undefined),
                      Math.max(0, 500 - (performance.now() - checkpoint)),
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
          if (event.type === 'image') image = event.image;
          if (event.type === 'complete') {
            completed = true;
            break;
          }
          const previous = task.activity;
          if (event.type === 'delta' && event.text) {
            raw += event.text;
            task.activity = 'generating';
          } else if (event.type === 'activity' && task.activity !== 'generating') {
            task.activity = event.phase;
          }
          if (previous !== task.activity) this.changed(task.pageUrl);
        }
        if (raw !== savedRaw && performance.now() - checkpoint >= 500) {
          await this.write({ type: 'DB_CHECKPOINT', payload: { runId: task.id, raw: raw } });
          savedRaw = raw;
          checkpoint = performance.now();
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
        !image &&
        !new TagStreamParser().feed(raw).some((s) => (s.type === 'text' ? s.text : s.term).trim())
      )
        throw new Error('The model returned no explanation. Check the model and endpoint.');
      task.phase = 'saving';
      if (!(await this.write({ type: 'DB_SAVING', payload: { runId: task.id } }))) return;
      this.changed(task.pageUrl);
      if (image) await this.writeImage(task.id, image, signal);
      await this.write({
        type: 'DB_FINISH',
        payload: {
          runId: task.id,
          raw,
          status: 'completed',
          latencyMs: Math.round(performance.now() - started),
        },
      });
    } catch (error) {
      if (task.discarded) return;
      const storageFailure = error instanceof ReadingWriteError;
      task.phase = 'settling';
      await this.finishFailure(task, {
        ...(storageFailure ? {} : { raw }),
        status: storageFailure
          ? 'failed'
          : signal.aborted
            ? 'cancelled'
            : error instanceof IncompleteGeneration
              ? 'interrupted'
              : 'failed',
        reason: storageFailure
          ? 'save-failed'
          : signal.aborted
            ? 'stopped'
            : error instanceof IncompleteGeneration
              ? error.reason
              : 'provider-error',
        error:
          !storageFailure && signal.aborted
            ? 'Stopped. Partial explanation retained.'
            : error instanceof Error
              ? error.message
              : String(error),
        latencyMs: Math.round(performance.now() - started),
      });
    } finally {
      task.controller.abort();
      await stream?.return(undefined).catch(() => {});
      this.release(task);
    }
  }
  private async finishFailure(
    attempt: ReadingAttempt,
    result: Omit<DbRequest<'DB_FINISH'>['payload'], 'runId'>,
  ) {
    try {
      await this.db({ type: 'DB_FINISH', payload: { ...result, runId: attempt.id } });
    } catch (error) {
      if (!attempt.discarded)
        this.stranded.set(attempt.selectionId, {
          runId: attempt.id,
          error:
            result.reason === 'save-failed' ? result.error! : new ReadingWriteError(error).message,
          latencyMs: result.latencyMs,
        });
    }
  }
  private release(attempt: ReadingAttempt) {
    attempt.credential = '';
    this.attempts.delete(attempt.id);
    this.changed(attempt.pageUrl);
    this.pump();
  }
  private async writeImage(runId: string, image: GeneratedImage, signal: AbortSignal) {
    for (let offset = 0; offset < image.data.length; offset += 200_000) {
      signal.throwIfAborted();
      await this.write({
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
  stop(selectionId: string) {
    return this.control(async () => {
      const attempt = [...this.attempts.values()].find(
        (a) => !a.discarded && a.selectionId === selectionId,
      );
      if (!attempt || attempt.phase === 'saving' || attempt.phase === 'settling') return;
      attempt.controller.abort();
      if (attempt.phase === 'queued') {
        attempt.phase = 'settling';
        await this.finishFailure(attempt, {
          status: 'cancelled',
          reason: 'stopped',
          error: 'Stopped before generation.',
          latencyMs: 0,
        });
        this.release(attempt);
      }
    });
  }
  remove(selectionId?: string) {
    return this.control(async () => {
      // Delete first: foreign keys and conditional writes make every late event inert.
      await this.db(
        selectionId
          ? { type: 'DB_DELETE_SELECTION', payload: { selectionId } }
          : { type: 'DB_CLEAR_HISTORY', payload: undefined },
      );
      for (const attempt of this.attempts.values())
        if (!selectionId || attempt.selectionId === selectionId) {
          attempt.discarded = true;
          attempt.controller.abort();
          if (attempt.phase === 'queued') {
            attempt.credential = '';
            this.attempts.delete(attempt.id);
          }
        }
      if (selectionId) this.stranded.delete(selectionId);
      else this.stranded.clear();
      this.changed('*');
      this.pump();
    });
  }
  resolveReuse(payload: DbRequest<'DB_READING_RESOLVE'>['payload']) {
    return this.control(() => this.db({ type: 'DB_READING_RESOLVE', payload }));
  }
  async updateReadState(message: DbRequest<'DB_VIEW' | 'DB_SET_BOOKMARK'>) {
    await this.recover();
    await this.db(message);
    this.changed('*');
  }
  query<K extends ReadingQuery>(message: DbRequest<K>): Promise<DbOperations[K]['result']>;
  async query(message: DbRequest<ReadingQuery>) {
    await this.recover();
    switch (message.type) {
      case 'DB_GET_HISTORY':
        return (await this.db(message)).map((item) => ({
          ...item,
          latest: this.projectAttempt(item.selectionId, item.latest),
        }));
      case 'DB_RUNS':
        return (await this.db(message)).map((run) =>
          this.projectAttempt(message.payload.selectionId, run),
        );
      case 'DB_PAGE':
        return (await this.db(message)).map((passage) => this.projectPassage(passage));
      case 'DB_PASSAGE': {
        const passage = await this.db(message);
        return passage && this.projectPassage(passage);
      }
      default:
        return this.db(message);
    }
  }
  private projectAttempt(selectionId: string, run: RunResult): RunResult {
    const attempt = this.attempts.get(run.id);
    const failure = this.stranded.get(selectionId);
    if (failure?.runId === run.id && ['queued', 'running', 'saving'].includes(run.status))
      return { ...run, status: 'failed', error: failure.error, reason: 'save-failed' };
    if (attempt && run.status === 'running') return { ...run, activity: attempt.activity };
    return run;
  }
  private projectPassage(passage: Passage): Passage {
    return { ...passage, latest: this.projectAttempt(passage.snapshot.id, passage.latest) };
  }
}
