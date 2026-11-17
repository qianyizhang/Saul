import type { DbCall } from '../../shared/protocol/history-types.ts';
import type { PreparedModel } from '../configuration/resolve';
import type { ModelRequest } from '../../shared/model/execution-route.ts';
import { streamModel } from '../providers/stream';
import { actionHost } from './host';
import {
  BUILDER_PROMPT,
  type CallEditRequest,
  type CallEditorState,
  type CallChoices,
  type CallDraft,
  type CallEditorStorage,
  type SavedCallChoices,
} from './contract';
import { validateActionModule } from '../../shared/protocol/action-protocol.mts';

export type CallPresetPreparation = (id: string) => Promise<PreparedModel>;
type Build = { controller: AbortController; task: Promise<void>; draft: CallDraft };
type Change = Exclude<CallEditRequest, { action: 'status' | 'stop' }>;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Owns Call editing. Durable choices, the resumable form and the active build are independent. */
export class CallEditor {
  private readonly ready: Promise<void>;
  private draft: CallDraft = {};
  private active?: Build;
  private lane: Promise<unknown> = Promise.resolve();
  private error?: string;

  private db: DbCall;
  private prepare: CallPresetPreparation;
  private generate: typeof streamModel;
  private storage: CallEditorStorage;

  constructor({
    db,
    prepare,
    generate = streamModel,
    storage,
  }: {
    db: DbCall;
    prepare: CallPresetPreparation;
    generate?: typeof streamModel;
    storage: CallEditorStorage;
  }) {
    this.db = db;
    this.prepare = prepare;
    this.generate = generate;
    this.storage = storage;
    this.ready = this.loadDraft();
  }

  private async loadDraft() {
    try {
      const { building, ...draft } = await this.storage.readDraft();
      this.draft = draft;
      if (building) {
        // This describes the previous worker. There is no model request to resume.
        this.draft.error = 'Call creation was interrupted. Revise the call to try again.';
        await this.storage.saveDraft(this.draft);
      }
    } catch (error) {
      // A local draft failure must not make a durable selection unavailable.
      this.error = messageOf(error);
    }
  }

  request(request: CallEditRequest): Promise<CallEditorState> {
    // Read failure is retryable; a successfully read but invalid record still
    // returns a blocked snapshot and its explicit repair actions.
    if (request.action === 'status')
      return this.ready.then(async () => this.snapshot(await this.storage.readChoices()));
    if (request.action === 'stop') {
      return this.enqueue(() => {
        const build = this.active;
        build?.controller.abort();
        return build;
      }).then(async (build) => {
        // Wait outside the command lane so a second Stop also observes settlement.
        await build?.task;
        return this.snapshot();
      });
    }
    return this.enqueue(async () => {
      if (this.active) throw new Error('Stop building the call or wait for it to finish.');
      this.error = undefined;
      try {
        const saved = await this.storage.readChoices();
        const choices = await this.change(request, saved);
        return this.snapshot(choices === undefined ? saved : { ...saved, state: 'ready', choices });
      } catch (error) {
        this.error = messageOf(error);
      }
      return this.snapshot();
    });
  }

  private enqueue<T>(control: () => T | Promise<T>): Promise<T> {
    const next = this.lane.then(async () => {
      await this.ready;
      return control();
    });
    this.lane = next.catch(() => undefined);
    return next;
  }

  private async snapshot(saved?: SavedCallChoices): Promise<CallEditorState> {
    let readError: string | undefined;
    try {
      saved ??= await this.storage.readChoices();
    } catch (error) {
      readError = messageOf(error);
    }
    const draft = this.active?.draft ?? this.draft;
    return structuredClone({
      ...(saved?.state === 'ready' ? saved.choices : { blocked: true }),
      ...draft,
      building: !!this.active,
      error: this.error ?? (saved?.state === 'invalid' ? saved.error : readError) ?? draft.error,
    });
  }

  private async change(request: Change, saved: SavedCallChoices) {
    if (request.action === 'builtin') {
      const choices = saved.state === 'ready' ? saved.choices : { library: [] };
      const { selected, ...retained } = choices;
      if (selected) retained.previous = selected;
      if (selected || saved.state === 'invalid')
        await this.storage.saveChoices(saved.source, retained);
      // Clear only the view's error; do not pair a selection change with a draft write.
      delete this.draft.error;
      return retained;
    }
    if (saved.state === 'invalid') throw new Error(saved.error);
    const choices = saved.choices;
    if (request.action === 'build') {
      this.draft.prompt = request.prompt;
      const preset = await this.prepare(request.presetId);
      await this.prune(choices, this.draft.candidate?.revision);
      const input = {
        ...preset.choices,
        systemPrompt: BUILDER_PROMPT,
        userPrompt: JSON.stringify({
          request: request.prompt,
          current: this.draft.candidate ?? choices.selected?.revision,
          previousError: this.draft.error,
          previousResponse: this.draft.raw,
        }),
      };
      await this.startBuild(input, preset.credential);
      return;
    }
    if (request.action === 'stage' || request.action === 'file') {
      await this.prune(choices, this.draft.candidate?.revision);
      const result =
        request.action === 'stage'
          ? await actionHost({ action: 'stage', module: JSON.parse(request.json) })
          : await actionHost({ action: 'file', path: request.path });
      if (!result.revision) throw new Error('No checked candidate returned.');
      const draft: CallDraft = { ...this.draft, candidate: result.revision };
      delete draft.error;
      await this.storage.saveDraft(draft);
      this.draft = draft;
      return;
    }
    const library = choices.library ?? [];
    const choice =
      request.action === 'restore'
        ? choices.previous
        : request.action === 'select'
          ? library.find(
              (c) => c.revision.revision === request.revision && c.presetId === request.presetId,
            )
          : undefined;
    const revision = request.action === 'load' ? request.revision : choice?.revision.revision;
    const presetId = request.action === 'load' ? request.presetId : choice?.presetId;
    if (!revision || !presetId) throw new Error('The saved call preset is unavailable.');
    if (request.action === 'load' && this.draft.candidate?.revision !== revision)
      throw new Error('The candidate changed. Review it before saving.');
    if (choices.selected?.revision.revision === revision && choices.selected.presetId === presetId)
      return;
    const existing = library.some(
      (c) => c.revision.revision === revision && c.presetId === presetId,
    );
    if (!existing && library.length >= 128) throw new Error('Keep at most 128 call presets.');
    // Validate the exact choice before loading its module, including Restore.
    await this.prepare(presetId);
    await this.prune(choices, this.draft.candidate?.revision);
    const result = await actionHost({ action: 'load', revision });
    if (!result.revision?.approved || result.revision.revision !== revision)
      throw new Error('Action helper did not confirm this revision.');
    const selected = { revision: result.revision, presetId };
    const next = {
      previous: choices.selected ?? choices.previous,
      selected,
      library: existing ? library : [...library, selected],
    };
    await this.storage.saveChoices(saved.source, next);
    delete this.draft.error;
    return next;
  }

  private async prune(choices: CallChoices, candidate?: string) {
    const saved = await this.db({ type: 'DB_DIGEST_ACTION_REVISIONS', payload: undefined });
    const protect = new Set([...saved, ...(choices.library ?? []).map((c) => c.revision.revision)]);
    if (choices.selected) protect.add(choices.selected.revision.revision);
    if (choices.previous) protect.add(choices.previous.revision.revision);
    if (candidate) protect.add(candidate);
    await actionHost({ action: 'prune', protect: [...protect] });
  }

  private async startBuild(input: ModelRequest, credential: string) {
    const draft: CallDraft = { ...this.draft, raw: '' };
    delete draft.error;
    await this.storage.saveDraft({ ...draft, building: true });
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(300_000)]);
    const task = this.build(draft, input, credential, signal).finally(() => {
      this.active = undefined;
    });
    this.active = { controller, task, draft };
  }

  private async build(
    draft: CallDraft,
    input: ModelRequest,
    credential: string,
    signal: AbortSignal,
  ) {
    let completed = false;
    try {
      for await (const event of this.generate(input, credential, signal, { maxTokens: 16_000 })) {
        if (event.type === 'delta') {
          const raw = (draft.raw ?? '') + event.text;
          draft.raw = raw.slice(0, 100_000);
          if (raw.length > 100_000) throw new Error('Generated action exceeded the output limit.');
        } else if (event.type === 'complete') completed = true;
      }
      signal.throwIfAborted();
      if (!completed) throw new Error('Action creation ended without a completed model response.');
      const module: unknown = JSON.parse(draft.raw ?? '');
      validateActionModule(module);
      const result = await actionHost({ action: 'stage', module }, { signal });
      signal.throwIfAborted();
      if (!result.revision) throw new Error('The action helper returned no checked candidate.');
      draft.candidate = result.revision;
    } catch (error) {
      draft.error = signal.aborted
        ? 'Call creation stopped or timed out. Any output is incomplete.'
        : messageOf(error);
    }
    try {
      await this.storage.saveDraft(draft);
      this.draft = draft;
    } catch (error) {
      this.error = 'Call draft could not be saved. ' + messageOf(error);
    }
  }
}
