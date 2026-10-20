import { useState } from 'react';
import type { RunResult } from '../types/storage';

function TextBlock({
  label,
  text,
  response = false,
}: {
  label: string;
  text: string;
  response?: boolean;
}) {
  const [copied, setCopied] = useState<{ text: string; notice: string }>();
  return (
    <section className="saul-inspection-block" data-response={response} aria-label={label}>
      <div className="saul-inspection-heading">
        <strong>{label}</strong>
        <button
          type="button"
          disabled={!text}
          aria-label={`Copy ${label}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied({ text, notice: 'Copied' });
            } catch {
              setCopied({ text, notice: 'Could not copy. Select the text and copy it manually.' });
            }
          }}
        >
          Copy
        </button>
      </div>
      {copied?.text === text && <p role="status">{copied.notice}</p>}
      {text ? (
        <pre tabIndex={0} aria-label={`${label} text`}>
          {text}
        </pre>
      ) : (
        <p className="saul-inspection-note">No text recorded.</p>
      )}
    </section>
  );
}

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
