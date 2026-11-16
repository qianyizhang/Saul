import { useEffect, useRef, useState } from 'react';
import type { RecoveryChoice, SettingsReview } from '../models/settings-recovery';

export function SettingsRecovery({
  review,
  error,
  apply,
  cancel,
}: {
  review: SettingsReview;
  error: string;
  apply: (choices: Record<string, RecoveryChoice | undefined>) => void;
  cancel: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [choices, setChoices] = useState<Record<string, RecoveryChoice | undefined>>(() =>
    Object.fromEntries(
      review.changes.filter((change) => !change.conflict).map((change) => [change.id, 'mine']),
    ),
  );
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <form
      className="stack settings-recovery"
      aria-labelledby="recovery-title"
      onSubmit={(event) => {
        event.preventDefault();
        apply(choices);
      }}
    >
      <h2 id="recovery-title" ref={heading} tabIndex={-1}>
        Review latest settings
      </h2>
      <p>
        Your original draft stays intact until you apply these choices. Other saved changes are
        kept.
      </p>
      {!review.changes.length && <p role="status">Your edits already match the saved values.</p>}
      {review.changes.map((change, index) => (
        <fieldset key={change.id} className="recovery-change">
          <legend>{change.label}</legend>
          {change.conflict && (
            <p className="small">Changed elsewhere or removed — choose which value to keep.</p>
          )}
          <p className="small muted">When you started:</p>
          <pre className="recovery-value" tabIndex={0}>
            {change.original}
          </pre>
          <div className="recovery-choices">
            {(['mine', 'latest'] as const).map((choice) => (
              <div key={choice} className="recovery-choice">
                <label>
                  <input
                    type="radio"
                    name={`recovery-${index}`}
                    value={choice}
                    required
                    checked={choices[change.id] === choice}
                    onChange={() => setChoices((current) => ({ ...current, [change.id]: choice }))}
                  />
                  {choice === 'mine' ? 'Mine' : 'Latest'}
                </label>
                <pre className="recovery-value" tabIndex={0}>
                  {change[choice]}
                </pre>
              </div>
            ))}
          </div>
        </fieldset>
      ))}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <div className="row">
        <button type="submit" className="btn primary">
          Apply to draft
        </button>
        <button type="button" className="btn" onClick={cancel}>
          Cancel review
        </button>
      </div>
      <p className="small muted">
        Applying does not save. You can edit the reviewed draft before saving.
      </p>
    </form>
  );
}
