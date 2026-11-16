import type { RunResult } from '../types/storage';
import { TagStreamParser } from '../parser/tag-stream-parser';
import { AnnotatedTextView } from './AnnotatedTextView';
import { GeneratedImageView } from './GeneratedImageView';
import { RunDetails } from './RunDetails';
import { InputOutputInspector } from './InputOutputInspector';

/** Callers own attempt selection and disclosure; this content never starts an attempt. */
export function PastAttemptContent({
  run,
  selectionId,
  workspace = false,
}: {
  run: RunResult;
  selectionId: string;
  workspace?: boolean;
}) {
  return (
    <>
      {run.error && <p>{run.error}</p>}
      {run.inspection?.followUpQuestion && (
        <p
          {...(workspace
            ? { style: { whiteSpace: 'pre-wrap', fontWeight: 600 } }
            : { className: 'whitespace-pre-wrap' })}
        >
          {run.inspection.followUpQuestion}
        </p>
      )}
      {run.hasImage ? (
        <GeneratedImageView selectionId={selectionId} runId={run.id} workspace={workspace} />
      ) : (
        <AnnotatedTextView segments={new TagStreamParser().feed(run.responseRaw)} />
      )}
      <RunDetails run={run} />
      <InputOutputInspector run={run} />
    </>
  );
}
