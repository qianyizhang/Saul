import type { CallSnapshot } from '../../../shared/model/call-output.ts';
import { actionHost, type ActionRunHost } from '../../custom-actions/host-client';
import { planEvents } from '../../providers/chatgpt-plan';
import { streamModel } from '../../providers/stream';
import { parseSummary, summaryRequestInput } from './summary';
import type { DigestSource, Summary } from '../../../shared/model/call-batch.ts';
import { originalSummaryPlan, type FrozenModel } from '../../../shared/model/execution-route.ts';

export type FrozenCall =
  | {
      kind: 'summarize';
      instructions: string;
      model:
        | { kind: 'preset'; input: FrozenModel }
        | {
            kind: 'plan';
            accountId?: string;
            model?: string;
            effort?: string;
            credentialOwner: 'local' | 'saul';
            connectionKey?: string;
          };
    }
  | { kind: 'script'; revision: string; input?: FrozenModel };

export interface CapturedPageContext {
  title: string;
  url: string;
  source: DigestSource;
}

export type CallOutcome = { output: CallSnapshot } & (
  | {
      kind: 'completed';
      result: { kind: 'summary'; summary: Summary } | { kind: 'text'; text: string };
    }
  | { kind: 'failed'; failure: 'execution' | 'summary-format'; message: string }
  | { kind: 'cancelled'; message: string }
);

export interface CallExecutor {
  execute(
    request: { call: FrozenCall; page: CapturedPageContext },
    options: {
      credential: string;
      admitGeneration?: () => Promise<string | undefined>;
      signal: AbortSignal;
      onProgress: (snapshot: CallSnapshot) => void;
    },
  ): Promise<CallOutcome>;
}

/** Transport adapters vary in production and offline checks; the runner sees only execution. */
export function createCallExecutor(
  adapters: Partial<{
    model: typeof streamModel;
    plan: typeof planEvents;
    script: ActionRunHost;
  }> = {},
): CallExecutor {
  const model = adapters.model ?? streamModel;
  const plan = adapters.plan ?? planEvents;
  const script = adapters.script ?? actionHost;
  return {
    async execute(request, { credential, signal: callerSignal, admitGeneration, onProgress }) {
      // Caller edits cannot retarget an executing Call.
      const { call, page } = structuredClone(request);
      const { source } = page;
      const lifetime = new AbortController();
      const signal = AbortSignal.any([callerSignal, lifetime.signal]);
      const publicationFailure = Promise.withResolvers<CallOutcome>();
      let publicationFailed = false;
      const output: CallSnapshot = { raw: '' };
      let active = true;
      let failure: 'execution' | 'summary-format' = 'execution';
      let dirty = false;
      let lastPublished = -Infinity;
      let publication: ReturnType<typeof setTimeout> | undefined;
      const snapshot = () => {
        // Keep incoming deltas in their transcripts. Joining and detaching belong
        // to observation, not the provider's token cadence.
        if (output.calls) output.raw = output.calls.map((c) => c.output).join('\n\n');
        return structuredClone(output);
      };
      const flush = () => {
        clearTimeout(publication);
        publication = undefined;
        if (!active || !dirty || publicationFailed) return;
        dirty = false;
        lastPublished = performance.now();
        try {
          onProgress(snapshot());
        } catch (cause) {
          // Timed and terminal observations use the same failure path as an
          // immediate observation. A stuck adapter cannot delay this settlement.
          publicationFailed = true;
          lifetime.abort(cause);
          delete output.progress;
          const message = cause instanceof Error ? cause.message : String(cause);
          const partial = snapshot();
          publicationFailure.resolve(
            callerSignal.aborted
              ? { kind: 'cancelled', output: partial, message }
              : { kind: 'failed', failure: 'execution', output: partial, message },
          );
        }
      };
      const publish = () => {
        if (!active || signal.aborted) return;
        dirty = true;
        const delay = Math.max(0, 50 - (performance.now() - lastPublished));
        if (!delay) flush();
        else if (publication === undefined)
          publication = setTimeout(() => {
            publication = undefined;
            if (!signal.aborted) flush();
          }, delay);
        signal.throwIfAborted();
      };
      const terminalSnapshot = () => {
        if (output.progress !== undefined) {
          delete output.progress;
          dirty = true;
        }
        // Flush buffered output even on Stop. This is the last publication,
        // before the outcome settles; no timer or retained callback survives it.
        flush();
        return snapshot();
      };
      const run = async (): Promise<CallOutcome> => {
        try {
          signal.throwIfAborted();
          if (call.kind === 'script') {
            const input = call.input;
            if (!input)
              throw new Error('The saved action preset is unavailable. Start a new summary.');
            const result = await script(
              {
                action: 'run',
                revision: call.revision,
                source: {
                  title: page.title,
                  url: page.url,
                  coverage: source.coverage,
                  ...(source.kind === 'pdf-url'
                    ? { pdfUrl: source.attachment.url }
                    : { text: source.text }),
                },
              },
              {
                signal,
                progress: (text) => {
                  if (!active || signal.aborted) return;
                  output.progress = text;
                  publish();
                },
                generate: async (request, callSignal) => {
                  const generationSignal = AbortSignal.any([signal, callSignal]);
                  generationSignal.throwIfAborted();
                  if (!active) throw new Error('Call execution has ended.');
                  const runGeneration = await admitGeneration?.();
                  generationSignal.throwIfAborted();
                  const transcript = {
                    instructions: request.instructions,
                    input: request.input ?? summaryRequestInput(page, source).userPrompt,
                    output: '',
                    complete: false,
                  };
                  (output.calls ??= []).push(transcript);
                  publish();
                  const events = model(
                    { ...input, systemPrompt: request.instructions, userPrompt: transcript.input },
                    credential,
                    generationSignal,
                    {
                      ...(source.kind === 'pdf-url' && { attachments: [source.attachment] }),
                      runGeneration,
                    },
                  );
                  let complete = false;
                  for await (const event of events) {
                    if (!active) throw new Error('Call execution has ended.');
                    if (event.type === 'delta') {
                      transcript.output += event.text;
                      publish();
                      if (transcript.output.length > 60_000)
                        throw new Error('Action model output exceeded 60,000 characters.');
                    }
                    if (event.type === 'complete') complete = true;
                  }
                  generationSignal.throwIfAborted();
                  if (!complete) throw new Error('Model response was incomplete.');
                  transcript.complete = true;
                  publish();
                  return transcript.output;
                },
              },
            );
            signal.throwIfAborted();
            if (
              typeof result.text !== 'string' ||
              !result.text.trim() ||
              result.text.length > 60_000
            )
              throw new Error('Action returned no valid final text.');
            return {
              kind: 'completed',
              output: terminalSnapshot(),
              result: { kind: 'text', text: result.text },
            };
          }

          const { userPrompt, attachments } = summaryRequestInput(page, source);
          const runGeneration = await admitGeneration?.();
          signal.throwIfAborted();
          const events = (() => {
            if (call.model.kind === 'preset')
              return model(
                { ...call.model.input, systemPrompt: call.instructions, userPrompt },
                credential,
                signal,
                { attachments, runGeneration },
              );
            const route = originalSummaryPlan(call.model);
            return plan(
              {
                action: 'generate',
                ...route.plan,
                ...(route.binding.kind === 'connection'
                  ? { connectionKey: route.binding.key }
                  : {}),
                systemPrompt: call.instructions,
                userPrompt,
                ...(attachments ? { attachments } : {}),
                ...(runGeneration ? { runGeneration } : {}),
              },
              signal,
              route.owner,
            );
          })();
          let complete = false;
          for await (const event of events) {
            signal.throwIfAborted();
            if (event.type === 'delta') {
              output.raw += event.text;
              publish();
              if (output.raw.length > 30000) throw new Error('Summary exceeded the output limit.');
            }
            if (event.type === 'complete') complete = true;
          }
          signal.throwIfAborted();
          if (!complete) throw new Error('Generation ended without a completed response.');
          failure = 'summary-format';
          const summary = parseSummary(output.raw);
          return {
            kind: 'completed',
            output: terminalSnapshot(),
            result: { kind: 'summary', summary },
          };
        } catch (error) {
          let message = error instanceof Error ? error.message : String(error);
          if (callerSignal.aborted)
            return { kind: 'cancelled', output: terminalSnapshot(), message };
          if (
            call.kind === 'summarize' &&
            source.kind === 'pdf-url' &&
            failure === 'execution' &&
            (call.model.kind === 'plan' || call.model.input.provider === 'chatgpt-plan')
          )
            message +=
              ' PDF URL attachment failed; OpenAI must be able to fetch the URL and the model must support PDF input. No local fallback was used. Choose Local PDF processing in Settings and Run again to send extracted text instead.';
          return { kind: 'failed', output: terminalSnapshot(), failure, message };
        }
      };
      try {
        return await Promise.race([run(), publicationFailure.promise]);
      } finally {
        active = false;
        clearTimeout(publication);
        lifetime.abort();
      }
    },
  };
}
