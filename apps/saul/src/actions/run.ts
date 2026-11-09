import { actionHost } from './host';
import { streamModel } from '../models/provider';
import { summaryRequestInput } from '../digest/summary';
import type { DigestBatch, DigestItem, DigestSource } from '../digest/types';
import type { ActionGenerate } from '../../native/action-protocol.mts';

export async function runCustomAction(
  batch: DigestBatch,
  item: DigestItem,
  source: DigestSource,
  credential: string,
  signal: AbortSignal,
) {
  const action = batch.action!;
  const input = action.input;
  if (!input) throw new Error('The saved action preset is unavailable. Start a new summary.');
  const result = await actionHost(
    {
      action: 'run',
      revision: action.revision.revision,
      source: {
        title: item.title,
        url: item.url,
        coverage: source.coverage,
        ...(source.kind === 'pdf-url' ? { pdfUrl: source.attachment.url } : { text: source.text }),
      },
    },
    {
      signal,
      progress: (text) => {
        item.progress = text;
      },
      generate: async (request: ActionGenerate, callSignal) => {
        const transcript = {
          instructions: request.instructions,
          input: request.input ?? summaryRequestInput(item, source).userPrompt,
          output: '',
          complete: false,
        };
        (item.calls ??= []).push(transcript);
        let complete = false;
        const events = streamModel(
          { ...input, systemPrompt: request.instructions, userPrompt: transcript.input },
          credential,
          callSignal,
          source.kind === 'pdf-url' ? { attachments: [source.attachment] } : undefined,
        );
        for await (const event of events) {
          if (event.type === 'delta') {
            transcript.output += event.text;
            item.raw = item.calls.map((c) => c.output).join('\n\n');
            if (transcript.output.length > 60_000)
              throw new Error('Action model output exceeded 60,000 characters.');
          }
          if (event.type === 'complete') complete = true;
        }
        callSignal.throwIfAborted();
        if (!complete) throw new Error('Model response was incomplete.');
        transcript.complete = true;
        return transcript.output;
      },
    },
  );
  signal.throwIfAborted();
  if (typeof result.text !== 'string' || !result.text.trim() || result.text.length > 60_000)
    throw new Error('Action returned no valid final text.');
  return result.text;
}
