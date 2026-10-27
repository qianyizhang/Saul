import { useState } from 'react';
import { InspectionText as TextBlock } from './InspectionText';
import type { RunResult } from '../types/storage';

export function InputOutputInspector({ run }: { run: RunResult }) {
  const [open, setOpen] = useState(false);
  const input = run.inspection;
  return (
    <details className="saul-inspector" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Inspect input/output</summary>
      {open && (
        <div className="saul-inspection-content">
          <p className="saul-inspection-note">{run.status}</p>
          <p className="saul-inspection-note">
            Saved text for this attempt. Context fields are included in the assembled prompt.
          </p>
          {run.status === 'queued' && (
            <p className="saul-inspection-note">Prepared input · waiting to send.</p>
          )}
          {run.error && <p className="saul-inspection-note">{run.error}</p>}
          {input ? (
            <>
              <TextBlock label="Instructions" text={input.systemPrompt} />
              <details className="saul-inspection-context">
                <summary>Context / inputs</summary>
                {(
                  [
                    ['Selected text', input.context.selection],
                    ['Page title', input.context.pageTitle],
                    ['Page URL', input.context.pageUrl],
                    ['Heading', input.context.heading],
                    ['Paragraph', input.context.paragraph],
                    ['Surrounding text', input.context.surroundingText],
                  ] as const
                )
                  .filter(([, value]) => value !== undefined && value !== '')
                  .map(([label, value]) => (
                    <TextBlock key={label} label={label} text={value!} />
                  ))}
              </details>
              <TextBlock label="Prompt · user" text={input.userPrompt} />
            </>
          ) : (
            <p className="saul-inspection-note">
              The exact input was not recorded for this older attempt.
            </p>
          )}
          <TextBlock label="Response · raw text" text={run.responseRaw} response />
        </div>
      )}
    </details>
  );
}
