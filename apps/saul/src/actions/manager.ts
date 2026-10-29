import type { DbCall, RunInput } from '../types/storage';
import { streamModel } from '../models/provider';
import { actionHost } from './host';
import {
  ACTION_STATE_KEY,
  BUILDER_PROMPT,
  actionState,
  type ActionRequest,
  type ActionState,
} from './contract';
import { validateActionModule } from '../../native/action-protocol.mts';

export class ActionManager {
  readonly ready: Promise<void>;
  private state: ActionState = {};
  private lane: Promise<unknown> = Promise.resolve();
  private building?: { controller: AbortController; task: Promise<void> };
  constructor(
    private db: DbCall,
    private generate = streamModel,
    private storage = {
      read: actionState,
      write: (state: ActionState) => chrome.storage.local.set({ [ACTION_STATE_KEY]: state }),
    },
  ) {
    this.ready = (async () => {
      this.state = await this.storage.read();
      if (this.state.building) {
        this.state.building = false;
        this.state.error =
          'Action creation was interrupted. Nothing was loaded or replayed. Revise explicitly.';
        await this.save();
      }
    })().catch((error: unknown) => {
      this.state = { blocked: true, error: error instanceof Error ? error.message : String(error) };
    });
  }
  request(
    request: ActionRequest,
    prepared?: { input: RunInput; credential: string },
  ): Promise<ActionState> {
    if (request.action === 'status') return this.ready.then(() => structuredClone(this.state));
    if (request.action === 'stop')
      return this.ready.then(async () => {
        this.building?.controller.abort();
        await this.building?.task;
        return structuredClone(this.state);
      });
    const work = this.lane.then(async () => {
      await this.ready;
      if (this.building) throw new Error('Stop action creation or wait for it to finish.');
      if (this.state.blocked && request.action !== 'builtin')
        throw new Error('Use built-in summary to recover invalid action settings.');
      try {
        if (request.action === 'build') {
          if (!prepared) throw new Error('Choose a saved builder preset.');
          this.state.prompt = request.prompt;
          // Check the optional helper and retain referenced code before spending model quota.
          await this.prune();
          const context = this.state.candidate || this.state.selected?.revision;
          const input = {
            ...prepared.input,
            systemPrompt: BUILDER_PROMPT,
            userPrompt: JSON.stringify({
              request: request.prompt,
              current: context,
              previousError: this.state.error,
              previousResponse: this.state.raw,
            }),
          };
          await this.commit((next) => {
            next.raw = '';
            delete next.error;
            next.building = true;
          });
          const controller = new AbortController();
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(300_000)]);
          const task = this.build(input, prepared.credential, signal).finally(() => {
            this.building = undefined;
          });
          this.building = { controller, task };
        } else if (request.action === 'builtin') {
          await this.commit((next) => {
            if (next.selected) next.previous = next.selected;
            delete next.selected;
            delete next.error;
            delete next.blocked;
          });
        } else if (request.action === 'load' || request.action === 'restore') {
          const choice = request.action === 'restore' ? this.state.previous : undefined;
          const revision = request.action === 'load' ? request.revision : choice?.revision.revision;
          const presetId = request.action === 'load' ? request.presetId : choice?.presetId;
          if (!revision || !presetId) throw new Error('No previous working action is available.');
          if (request.action === 'load' && this.state.candidate?.revision !== revision)
            throw new Error('The candidate changed. Preview and Load the checked candidate.');
          if (
            this.state.selected?.revision.revision === revision &&
            this.state.selected.presetId === presetId
          )
            return structuredClone(this.state);
          const result = await actionHost({ action: 'load', revision });
          if (!result.revision?.approved || result.revision.revision !== revision)
            throw new Error('Action helper did not confirm this revision.');
          const approved = result.revision;
          await this.commit((next) => {
            if (next.selected) next.previous = next.selected;
            next.selected = { revision: approved, presetId };
            delete next.error;
          });
          await this.prune();
        } else {
          const result =
            request.action === 'stage'
              ? await actionHost({ action: 'stage', module: JSON.parse(request.json) })
              : await actionHost({ action: 'file', path: request.path });
          if (!result.revision) throw new Error('No checked candidate returned.');
          const candidate = result.revision;
          await this.commit((next) => {
            next.candidate = candidate;
            delete next.error;
          });
          await this.prune();
        }
      } catch (error) {
        this.state.error = (error as Error).message;
        await this.save();
      }
      return structuredClone(this.state);
    });
    this.lane = work.catch(() => undefined);
    return work;
  }
  private save() {
    return this.storage.write(structuredClone(this.state));
  }
  private async commit(update: (next: ActionState) => void) {
    const next = structuredClone(this.state);
    update(next);
    await this.storage.write(next);
    this.state = next;
  }
  private async prune() {
    const saved = await this.db({ type: 'DB_DIGEST_ACTION_REVISIONS', payload: undefined });
    const protect = [
      ...saved,
      ...[
        this.state.selected?.revision.revision,
        this.state.previous?.revision.revision,
        this.state.candidate?.revision,
      ].filter((s): s is string => !!s),
    ];
    await actionHost({ action: 'prune', protect });
  }
  private async build(input: RunInput, credential: string, signal: AbortSignal) {
    try {
      let complete = false;
      for await (const event of this.generate(input, credential, signal, { maxTokens: 16_000 })) {
        if (event.type === 'delta') {
          this.state.raw = (this.state.raw || '') + event.text;
          if (this.state.raw.length > 100_000) {
            this.state.raw = this.state.raw.slice(0, 100_000);
            throw new Error('Generated action exceeded the output limit.');
          }
        }
        if (event.type === 'complete') complete = true;
      }
      signal.throwIfAborted();
      if (!complete) throw new Error('Action creation ended without a completed model response.');
      const module: unknown = JSON.parse(this.state.raw || '');
      validateActionModule(module);
      const result = await actionHost({ action: 'stage', module }, { signal });
      if (!result.revision) throw new Error('The action helper returned no checked candidate.');
      this.state.candidate = result.revision;
    } catch (error) {
      this.state.error = signal.aborted
        ? 'Action creation stopped or timed out. Available output is incomplete; nothing was loaded.'
        : (error as Error).message;
    } finally {
      this.state.building = false;
      try {
        await this.save();
      } catch {
        this.state.error =
          'Action draft could not be saved. Nothing was loaded; do not assume this draft is durable.';
      }
    }
  }
}
