import { Worker } from 'node:worker_threads';
import { checkAction } from './action-check.mts';
import { ActionStore } from './action-store.mts';
import {
  ACTION_MAX_CALLS,
  ACTION_TIMEOUT_MS,
  validateActionGenerate,
  type ActionHostEvent,
  type ActionSource,
} from './action-protocol.mts';

interface Running {
  emit: (event: ActionHostEvent) => void;
  finish: (error?: Error, text?: string) => void;
  calls: Set<number>;
}
interface Generation {
  worker: Worker;
  runs: Map<string, Running>;
  stopping?: Error;
}
export class ActionRuntime {
  private generations = new Map<string, Promise<Generation>>();
  private workers = new Set<Worker>();
  private closed = false;
  private current?: string;
  readonly store: ActionStore;
  private timeoutMs: number;
  private initMs: number;
  constructor(store: ActionStore, timeoutMs = ACTION_TIMEOUT_MS, initMs = 10_000) {
    this.store = store;
    this.timeoutMs = timeoutMs;
    this.initMs = initMs;
  }
  private async prepare(revision: string): Promise<Generation> {
    if (this.closed) throw new Error('Action runtime is closed.');
    const existing = this.generations.get(revision);
    if (existing) return existing;
    const loading = (async () => {
      const { contractVersion, name, description, language, source } =
        await this.store.get(revision);
      const { javascript } = checkAction({ contractVersion, name, description, language, source });
      if (this.closed) throw new Error('Action runtime is closed.');
      const worker = new Worker(new URL('./action-worker.mjs', import.meta.url), {
        workerData: { javascript },
        stdout: true,
        stderr: true,
      });
      this.workers.add(worker);
      // User logs must never corrupt native-message framing or expose prompts in helper diagnostics.
      worker.stdout?.resume();
      worker.stderr?.resume();
      const generation: Generation = { worker, runs: new Map() };
      await new Promise<void>((resolve, reject) => {
        let ready = false;
        const timer = setTimeout(() => {
          reject(new Error('Action initialization timed out.'));
          void worker.terminate();
        }, this.initMs);
        const fail = (error: Error) => {
          error = generation.stopping || error;
          clearTimeout(timer);
          if (!ready) reject(error);
          for (const run of [...generation.runs.values()]) run.finish(error);
          if (this.generations.get(revision) === loading) this.generations.delete(revision);
        };
        worker.on('error', fail);
        worker.on('exit', () => {
          this.workers.delete(worker);
          fail(new Error('Action runtime disconnected. No work was replayed.'));
        });
        worker.on(
          'message',
          (message: { ready?: boolean; id?: string; event?: ActionHostEvent }) => {
            if (message.ready && !ready) {
              ready = true;
              clearTimeout(timer);
              resolve();
              return;
            }
            if (!message.id || !message.event) return;
            const run = generation.runs.get(message.id);
            if (!run || generation.stopping) return;
            const event = message.event;
            try {
              if (event.type === 'generate') {
                validateActionGenerate(event.request);
                if (
                  !Number.isSafeInteger(event.callId) ||
                  event.callId !== run.calls.size + 1 ||
                  run.calls.size >= ACTION_MAX_CALLS
                )
                  throw new Error('Action exceeded the three-model-call limit.');
                run.calls.add(event.callId);
                run.emit(event);
              } else if (event.type === 'progress') {
                if (typeof event.text !== 'string' || event.text.length > 500)
                  throw new Error('Invalid progress.');
                run.emit(event);
              } else if (event.type === 'result') run.finish(undefined, event.text);
              else if (event.type === 'error') run.finish(new Error(event.message));
            } catch (error) {
              this.stopGeneration(
                revision,
                generation,
                error instanceof Error ? error : new Error(String(error)),
              );
            }
          },
        );
      });
      return generation;
    })();
    this.generations.set(revision, loading);
    try {
      return await loading;
    } catch (error) {
      this.generations.delete(revision);
      throw error;
    }
  }
  async load(revision: string) {
    await this.prepare(revision); // Explicit approval has occurred before this method is called.
    const value = await this.store.approve(revision);
    const previous = this.current;
    this.current = revision;
    if (previous && previous !== revision) await this.retire(previous);
    return value;
  }
  private async retire(revision: string) {
    if (revision === this.current) return;
    const pending = this.generations.get(revision);
    if (!pending) return;
    const generation = await pending.catch(() => undefined);
    if (generation && !generation.runs.size) {
      this.generations.delete(revision);
      await generation.worker.terminate();
    }
  }
  private stopGeneration(revision: string, generation: Generation, error: Error) {
    if (generation.stopping) return;
    generation.stopping = error;
    this.generations.delete(revision);
    // A terminal acknowledgement must follow actual worker exit, including synchronous loops.
    const finish = () => {
      for (const run of [...generation.runs.values()]) run.finish(error);
    };
    void generation.worker.terminate().then(finish, finish);
  }
  async run(
    id: string,
    revision: string,
    source: ActionSource,
    emit: (event: ActionHostEvent) => void,
    signal: AbortSignal,
  ) {
    const started = Date.now();
    const value = await this.store.get(revision);
    if (!value.approved)
      throw new Error('This revision has not been loaded. Check and Load it explicitly.');
    const generation = await this.prepare(revision);
    signal.throwIfAborted();
    const remaining = this.timeoutMs - (Date.now() - started);
    if (remaining <= 0) throw new Error('Action exceeded the five-minute page deadline.');
    return new Promise<string>((resolve, reject) => {
      const finish = (error?: Error, text?: string) => {
        if (!generation.runs.delete(id)) return;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        generation.worker.postMessage({ id, cancel: true });
        if (error) reject(error);
        else resolve(text || '');
        void this.retire(revision);
      };
      const kill = (message: string) => {
        this.stopGeneration(revision, generation, new Error(message));
      };
      const abort = () =>
        kill('Stopped. Outstanding model calls were cancelled; no work was replayed.');
      const timer = setTimeout(
        () => kill('Action exceeded the five-minute page deadline.'),
        remaining,
      );
      generation.runs.set(id, { emit, finish, calls: new Set() });
      signal.addEventListener('abort', abort, { once: true });
      generation.worker.postMessage({ id, source });
    });
  }
  async reply(
    revision: string,
    id: string,
    callId: number,
    result: { text?: string; error?: string },
  ) {
    const generation = await this.generations.get(revision);
    if (generation?.runs.get(id)?.calls.has(callId))
      generation.worker.postMessage({ id, callId, ...result });
  }
  async close() {
    this.closed = true;
    this.generations.clear();
    await Promise.allSettled([...this.workers].map((worker) => worker.terminate()));
  }
  async prune(protect: string[]) {
    await this.store.prune(new Set([...protect, ...this.generations.keys()]));
  }
}
