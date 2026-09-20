import type { DbCall, Passage, RunResult, QueuedRun, Submission } from '../types/storage';
import { streamOpenAICompatible } from '../models/openai-compatible';
import { streamChromeAi } from '../models/chrome-ai';
import { IncompleteGeneration } from '../models/events';
import { TagStreamParser } from '../parser/tag-stream-parser';

type Task = QueuedRun & {
  credential: string;
  controller: AbortController;
  raw: string;
  saving: boolean;
};
export class ReadingRunner {
  private tasks = new Map<string, Task>();
  private failures = new Map<string, { runId: string; raw: string; error: string }>();
  private active = new Set<string>();
  readonly ready: Promise<void>;
  constructor(
    private db: DbCall,
    private changed: (url: string) => void,
  ) {
    this.ready = db({ type: 'DB_RECOVER', payload: undefined });
  }
  async submit(submission: Submission, credential: string) {
    await this.ready;
    const failed = this.failures.get(submission.snapshot.id);
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
      if (count >= (provider === 'chrome-ai' ? 1 : 2)) continue;
      this.active.add(task.id);
      void this.execute(task);
    }
  }
  private async execute(task: Task) {
    const started = Date.now(),
      signal = task.controller.signal;
    try {
      if (signal.aborted || !(await this.db({ type: 'DB_CLAIM', payload: { runId: task.id } })))
        return;
      const input = task.input;
      const stream =
        input.provider === 'chrome-ai'
          ? streamChromeAi(input.local, input.systemPrompt, input.userPrompt, signal)
          : streamOpenAICompatible(
              { ...input.remote, apiKey: task.credential },
              input.systemPrompt,
              input.userPrompt,
              signal,
            );
      let completed = false,
        checkpoint = 0;
      for await (const event of stream) {
        if (signal.aborted) break;
        if (event.type === 'complete') completed = true;
        else task.raw += event.text;
        if (Date.now() - checkpoint >= 500) {
          await this.db({ type: 'DB_CHECKPOINT', payload: { runId: task.id, raw: task.raw } });
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
        !new TagStreamParser()
          .feed(task.raw)
          .some((s) => (s.type === 'text' ? s.text : s.term).trim())
      )
        throw new Error('The model returned no explanation. Check the model and endpoint.');
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
      task.credential = '';
      this.tasks.delete(task.id);
      this.active.delete(task.id);
      this.changed(task.pageUrl);
      this.pump();
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
    const failed = this.failures.get(selectionId);
    return failed?.runId === run.id && ['queued', 'running', 'saving'].includes(run.status)
      ? {
          ...run,
          status: 'failed',
          responseRaw: failed.raw,
          error: failed.error,
          reason: 'save-failed',
        }
      : run;
  }
  decorate(passage: Passage): Passage {
    return { ...passage, latest: this.decorateRun(passage.snapshot.id, passage.latest) };
  }
}
