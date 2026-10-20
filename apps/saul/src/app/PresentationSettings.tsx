import type { useMinimumMode } from './useMinimumMode';

export function PresentationSettings({
  preference,
}: {
  preference: ReturnType<typeof useMinimumMode>;
}) {
  return (
    <section className="panel settings-section" aria-label="Appearance">
      <label className="toggle">
        <span>
          <strong>Minimum Mode</strong>
          <span className="small muted preference-description">Fewer hints and details.</span>
        </span>
        <input
          type="checkbox"
          aria-label="Minimum Mode"
          checked={preference.minimum}
          disabled={!preference.loaded || preference.saving}
          onChange={(event) => void preference.toggle(event.target.checked)}
        />
      </label>
      {preference.error && (
        <p className="notice error" role="alert">
          {preference.error}
        </p>
      )}
    </section>
  );
}
