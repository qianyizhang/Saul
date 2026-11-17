import { actionHost } from './host';
import { planEvents } from '../providers/chatgpt-plan';
import { streamModel } from '../providers/stream';
import { parseSummary, summaryRequestInput } from '../digest/summary';
import type { DigestSource, Summary } from '../digest/types';
import type { FrozenModel } from '../providers/request';

export type FrozenCall =
  | {
      kind: 'summarize';
      instructions: string;
      model:
        | { kind: 'preset'; input: FrozenModel }
        | {
            kind: 'plan';
            accountId: string;
            model: string;
            effort?: string;
            credentialOwner: 'local' | 'saul';
          };
    }
  | { kind: 'script'; revision: string; input?: FrozenModel };

export interface CapturedPageContext {
  title: string;
  url: string;
  source: DigestSource;
}

export interface CallSnapshot {
  raw: string;
  progress?: string;
  calls?: { instructions: string; input: string; output: string; complete: boolean }[];
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
    script: typeof actionHost;
  }> = {},
): CallExecutor {
  const model = adapters.model ?? streamModel;
  const plan = adapters.plan ?? planEvents;
  const script = adapters.script ?? actionHost;
  return {
    async execute(request, { credential, signal, onProgress }) {
      // Caller edits cannot retarget an executing Call.
      const { call, page } = structuredClone(request);
      const { source } = page;
      const output: CallSnapshot = { raw: '' };
      let active = true;
      let failure: 'execution' | 'summary-format' = 'execution';
      const snapshot = () => structuredClone(output);
      const publish = () => {
        if (active && !signal.aborted) onProgress(snapshot());
      };
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
                  source.kind === 'pdf-url' ? { attachments: [source.attachment] } : undefined,
                );
                let complete = false;
                for await (const event of events) {
                  if (!active) throw new Error('Call execution has ended.');
                  if (event.type === 'delta') {
                    transcript.output += event.text;
                    output.raw = output.calls!.map((c) => c.output).join('\n\n');
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
          if (typeof result.text !== 'string' || !result.text.trim() || result.text.length > 60_000)
            throw new Error('Action returned no valid final text.');
          delete output.progress;
          return {
            kind: 'completed',
            output: snapshot(),
            result: { kind: 'text', text: result.text },
          };
        }

        const { userPrompt, attachments } = summaryRequestInput(page, source);
        const events =
          call.model.kind === 'preset'
            ? model(
                { ...call.model.input, systemPrompt: call.instructions, userPrompt },
                credential,
                signal,
                { attachments },
              )
            : plan(
                {
                  action: 'generate',
                  accountId: call.model.accountId,
                  model: call.model.model,
                  effort: call.model.effort,
                  systemPrompt: call.instructions,
                  userPrompt,
                  ...(attachments ? { attachments } : {}),
                },
                signal,
                call.model.credentialOwner,
              );
        let complete = false;
        for await (const event of events) {
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
        return { kind: 'completed', output: snapshot(), result: { kind: 'summary', summary } };
      } catch (error) {
        delete output.progress;
        let message = error instanceof Error ? error.message : String(error);
        if (signal.aborted) return { kind: 'cancelled', output: snapshot(), message };
        if (
          call.kind === 'summarize' &&
          source.kind === 'pdf-url' &&
          failure === 'execution' &&
          (call.model.kind === 'plan' || call.model.input.provider === 'chatgpt-plan')
        )
          message +=
            ' PDF URL attachment failed; OpenAI must be able to fetch the URL and the model must support PDF input. No local fallback was used. Choose Local PDF processing in Settings and Run again to send extracted text instead.';
        return { kind: 'failed', output: snapshot(), failure, message };
      } finally {
        active = false;
      }
    },
  };
}
