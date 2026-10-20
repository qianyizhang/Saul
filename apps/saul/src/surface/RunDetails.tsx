import type { RunResult } from '../types/storage';

/** Recorded facts for the displayed attempt, never the current provider draft. */
export function RunDetails({ run }: { run: RunResult }) {
  const provider =
    {
      'chatgpt-plan': 'ChatGPT plan',
      'openai-compatible': 'OpenAI compatible',
      'chrome-ai': 'Chrome on-device',
    }[run.provider] || run.provider;
  const rows = [
    ['Created', new Date(run.createdAt).toLocaleString()],
    ...(run.recipe ? [['Recipe', run.recipe.name]] : []),
    ...(run.preset ? [['Preset', run.preset.name]] : []),
    ['Provider', provider],
    ['Model', run.model],
    [
      'Total time',
      run.latencyMs === undefined ? 'Not recorded' : `${(run.latencyMs / 1000).toFixed(1)} s`,
    ],
  ];
  return (
    <details className="saul-run-details">
      <summary>Details</summary>
      <dl className="saul-metadata">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {run.provider === 'chatgpt-plan' && (
        <a
          className="saul-usage-link"
          href="https://chatgpt.com/settings/usage"
          target="_blank"
          rel="noreferrer"
        >
          Manage usage
        </a>
      )}
    </details>
  );
}
