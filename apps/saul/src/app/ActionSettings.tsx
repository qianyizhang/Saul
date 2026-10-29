import { useEffect, useRef, useState } from 'react';
import type { ModelPreset } from '../types';
import { ACTION_FORM_LIMITS, type ActionRequest, type ActionState } from '../actions/contract';
import { sendActionMessage } from '../storage/client';
import { InspectionText } from '../surface/InspectionText';

const FORM_KEY = 'saul_summary_action_editor_v1';
interface ActionForm {
  prompt: string;
  builderPreset: string;
  actionPreset: string;
  path: string;
}
function readForm(): Partial<ActionForm> {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(FORM_KEY) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const saved = value as Record<string, unknown>;
    const form: Partial<ActionForm> = {};
    const limits = {
      prompt: ACTION_FORM_LIMITS.prompt,
      builderPreset: ACTION_FORM_LIMITS.presetId,
      actionPreset: ACTION_FORM_LIMITS.presetId,
      path: ACTION_FORM_LIMITS.path,
    };
    for (const key of Object.keys(limits) as (keyof ActionForm)[]) {
      const text = saved[key];
      if (typeof text === 'string' && text.length <= limits[key]) form[key] = text;
    }
    return form;
  } catch {
    return {};
  }
}
function PresetField({
  label,
  value,
  presets,
  onChange,
}: {
  label: string;
  value: string;
  presets: ModelPreset[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      {label}
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose saved preset…</option>
        {value && !presets.some((p) => p.id === value) && (
          <option value={value} disabled>
            Unavailable preset
          </option>
        )}
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ActionSettings({
  presets,
  settingsDirty,
}: {
  presets: ModelPreset[];
  settingsDirty: boolean;
}) {
  const [state, setState] = useState<ActionState>();
  const [form, setForm] = useState(readForm);
  const { prompt = '', builderPreset = '', actionPreset = '', path = '' } = form;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const live = useRef(true);
  useEffect(() => {
    try {
      sessionStorage.setItem(FORM_KEY, JSON.stringify(form));
    } catch {
      /* Window draft caching is optional; approved selections use the trusted owner. */
    }
  }, [form]);
  function edit(patch: Partial<ActionForm>) {
    setForm((current) => ({ ...current, ...patch }));
  }
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  async function request(message: ActionRequest) {
    setBusy(true);
    setError('');
    try {
      const next = await sendActionMessage(message);
      if (live.current) {
        setState(next);
        if (message.action === 'status' && !state) {
          setForm((current) => ({
            prompt: next.prompt || '',
            actionPreset: next.selected?.presetId || presets[0]?.id || '',
            builderPreset: presets[0]?.id || '',
            ...current,
          }));
        }
      }
    } catch (e) {
      if (live.current) setError((e as Error).message);
    } finally {
      if (live.current) setBusy(false);
    }
  }
  const building = state?.building;
  useEffect(() => {
    if (!building) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await sendActionMessage({ action: 'status' });
        if (!disposed) {
          setState(next);
          if (next.building) timer = setTimeout(() => void refresh(), 700);
        }
      } catch (e) {
        if (!disposed) setError((e as Error).message);
      }
    };
    timer = setTimeout(() => void refresh(), 700);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [building]);
  const disabled = busy || building || settingsDirty;
  const candidate = state?.candidate;
  const alreadyLoaded =
    candidate?.revision === state?.selected?.revision.revision &&
    actionPreset === state?.selected?.presetId;
  return (
    <details
      onToggle={(event) => {
        if (event.currentTarget.open && !state && !busy) void request({ action: 'status' });
      }}
    >
      <summary>Customize Summarize</summary>
      <div className="stack settings-disclosure" aria-label="Summary action">
        <p role="status" className="small">
          {state?.blocked
            ? 'Action settings unavailable'
            : state
              ? `Current action: ${state.selected?.revision.name || 'Built-in bilingual summary'}`
              : 'Loading action…'}
        </p>
        {state?.selected && (
          <p className="small muted">
            Preset:{' '}
            {presets.find((p) => p.id === state.selected?.presetId)?.name || 'Unavailable preset'} ·
            revision {state.selected.revision.revision.slice(0, 10)}
          </p>
        )}
        {settingsDirty && (
          <p className="notice">
            Save or reload model settings before creating or loading an action.
          </p>
        )}
        <label className="field">
          Action request
          <textarea
            aria-label="Action request"
            disabled={!state}
            rows={3}
            maxLength={ACTION_FORM_LIMITS.prompt}
            value={prompt}
            onChange={(e) => edit({ prompt: e.target.value })}
            placeholder="Explain the main claim and its weakest evidence."
          />
        </label>
        <PresetField
          label="Builder preset"
          value={builderPreset}
          presets={presets}
          onChange={(value) => edit({ builderPreset: value })}
        />
        <div className="row">
          <button
            type="button"
            className="btn"
            disabled={disabled || !prompt.trim() || !presets.some((p) => p.id === builderPreset)}
            onClick={() => void request({ action: 'build', prompt, presetId: builderPreset })}
          >
            {candidate || state?.selected ? 'Revise action' : 'Create action'}
          </button>
          {building && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void request({ action: 'stop' })}
            >
              Stop creation
            </button>
          )}
        </div>
        <p className="small muted">
          Create/revise uses one model request. Review the checked code, then Load/Replace. The next
          Summarize runs it.
        </p>
        {building && <p role="status">Creating and checking action…</p>}
        {(error || state?.error) && (
          <p role="alert" className="notice error">
            {error || state?.error}
          </p>
        )}
        {candidate && (
          <div className="stack" aria-label="Checked candidate">
            <strong>{candidate.name}</strong>
            <p>{candidate.description}</p>
            <InspectionText label="Candidate source" text={candidate.source} />
            {state?.selected && candidate.revision !== state.selected.revision.revision && (
              <details>
                <summary>Current selected source</summary>
                <InspectionText label="Selected source" text={state.selected.revision.source} />
              </details>
            )}
            <PresetField
              label="Action preset"
              value={actionPreset}
              presets={presets}
              onChange={(value) => edit({ actionPreset: value })}
            />
            <p className="small muted">
              One run per page · Up to three model calls · Five minutes. Load runs trusted local
              code with your OS permissions. Initialization effects cannot be undone.
            </p>
            <button
              type="button"
              className="btn primary"
              disabled={disabled || !presets.some((p) => p.id === actionPreset) || alreadyLoaded}
              onClick={() =>
                void request({
                  action: 'load',
                  revision: candidate.revision,
                  presetId: actionPreset,
                })
              }
            >
              {alreadyLoaded ? 'Loaded' : state?.selected ? 'Replace action' : 'Load action'}
            </button>
          </div>
        )}
        <details>
          <summary>Local module and recovery</summary>
          <div className="stack settings-disclosure">
            <label className="field">
              Module file path
              <input
                aria-label="Module file path"
                value={path}
                maxLength={ACTION_FORM_LIMITS.path}
                onChange={(e) => edit({ path: e.target.value })}
                placeholder="/absolute/path/summarize.ts"
              />
            </label>
            <button
              type="button"
              className="btn"
              disabled={disabled || !path.trim()}
              onClick={() => void request({ action: 'file', path })}
            >
              Check file
            </button>
            <p className="small muted">
              Check file only reads and checks code. Review its candidate, then Load/Replace to
              reload an edit. No file watching.
            </p>
            {state?.previous && (
              <button
                type="button"
                className="btn"
                disabled={disabled}
                onClick={() => void request({ action: 'restore' })}
              >
                Restore previous action
              </button>
            )}
            {(state?.selected || state?.blocked) && (
              <button
                type="button"
                className="btn"
                disabled={disabled}
                onClick={() => void request({ action: 'builtin' })}
              >
                Use built-in summary
              </button>
            )}
            {state?.raw && (
              <InspectionText label="Builder response · may be incomplete" text={state.raw} />
            )}
            <p className="small muted">Optional helper setup:</p>
            <InspectionText
              label="Setup command"
              text={`node scripts/setup.mts --components actions --extension-id ${chrome.runtime.id}`}
            />
          </div>
        </details>
      </div>
    </details>
  );
}
