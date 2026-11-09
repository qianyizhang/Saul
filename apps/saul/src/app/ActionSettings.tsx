import { ActionLabel } from '../surface/ActionLabel';
import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  placeholder = 'Choose saved preset…',
  disabled = false,
}: {
  label: string;
  value: string;
  presets: ModelPreset[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      {label}
      <select
        aria-label={label}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder}</option>
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
  summaryPresetId,
  onSummaryPresetChange,
  settingsDirty,
  onBuildingChange,
  children,
}: {
  presets: ModelPreset[];
  summaryPresetId: string;
  onSummaryPresetChange: (id: string) => void;
  settingsDirty: boolean;
  onBuildingChange?: (building: boolean) => void;
  children: ReactNode;
}) {
  const writePresets = presets.filter(
    (p) => (p.capability ?? 'write') === 'write' && p.provider !== 'chrome-ai',
  );
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
    void request({ action: 'status' });
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
            actionPreset: next.selected?.presetId || summaryPresetId || writePresets[0]?.id || '',
            builderPreset: summaryPresetId || writePresets[0]?.id || '',
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
    onBuildingChange?.(!!building);
    return () => onBuildingChange?.(false);
  }, [building, onBuildingChange]);
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
  const canEditCall = state && !state.blocked && !disabled;
  const revise = Boolean(candidate || state?.selected);
  const buildLabel = revise ? 'Revise call' : 'Create call';
  const alreadyLoaded =
    candidate?.revision === state?.selected?.revision.revision &&
    actionPreset === state?.selected?.presetId;
  return (
    <div className="stack">
      {state && (
        <label className="field">
          Call preset
          <select
            aria-label="Call preset"
            disabled={!canEditCall}
            value={
              state.selected ? `${state.selected.revision.revision}:${state.selected.presetId}` : ''
            }
            onChange={(event) => {
              const choice = state.library?.find(
                (c) => `${c.revision.revision}:${c.presetId}` === event.target.value,
              );
              void request(
                choice
                  ? {
                      action: 'select',
                      revision: choice.revision.revision,
                      presetId: choice.presetId,
                    }
                  : { action: 'builtin' },
              );
            }}
          >
            <option value="">Summarize (default)</option>
            {(state.library || []).map((choice) => {
              const model = writePresets.find((p) => p.id === choice.presetId);
              const key = `${choice.revision.revision}:${choice.presetId}`;
              return (
                <option key={key} value={key} disabled={!model}>
                  {choice.revision.name} · {model?.name ?? 'Unavailable preset'}
                </option>
              );
            })}
          </select>
        </label>
      )}
      {state && !state.selected && (
        <PresetField
          label="Model preset"
          value={summaryPresetId}
          presets={writePresets}
          onChange={onSummaryPresetChange}
          placeholder="Original summary setup"
          disabled={busy || building}
        />
      )}
      {settingsDirty && (
        <p className="small muted">Save or reload settings to switch call presets.</p>
      )}
      {children}
      {(error || state?.error) && (
        <p role="alert" className="notice error">
          {error || state?.error}
        </p>
      )}
      <details
        onToggle={(event) => {
          if (event.currentTarget.open && !state && !busy) void request({ action: 'status' });
        }}
      >
        <summary aria-label="Customize Call Saul" title="Customize Call Saul">
          <ActionLabel short="Customize" full="Customize Call Saul" />
        </summary>
        <div className="stack settings-disclosure" aria-label="Customize call">
          {(!state || state.blocked) && (
            <p role="status" className="small">
              {state?.blocked ? 'Call settings unavailable' : 'Loading call settings…'}
            </p>
          )}
          <label className="field">
            Call request
            <textarea
              aria-label="Call request"
              disabled={!state}
              rows={3}
              maxLength={ACTION_FORM_LIMITS.prompt}
              value={prompt}
              onChange={(e) => edit({ prompt: e.target.value })}
              placeholder="Explain the main claim and its weakest evidence."
            />
          </label>
          <PresetField
            label="Build with"
            value={builderPreset}
            presets={writePresets}
            disabled={!canEditCall}
            onChange={(value) => edit({ builderPreset: value })}
          />
          <div className="row">
            <button
              type="button"
              className="btn"
              disabled={
                !canEditCall || !prompt.trim() || !writePresets.some((p) => p.id === builderPreset)
              }
              aria-label={buildLabel}
              title={buildLabel}
              onClick={() => void request({ action: 'build', prompt, presetId: builderPreset })}
            >
              <ActionLabel short={revise ? 'Revise' : 'Create'} full={buildLabel} />
            </button>
            {building && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void request({ action: 'stop' })}
                aria-label="Stop creation"
                title="Stop creation"
              >
                <ActionLabel short="Stop" full="Stop creation" />
              </button>
            )}
          </div>
          <p className="small muted standard-only">
            Creating or revising uses one model request. Review the code before saving.
          </p>
          {building && <p role="status">Building call…</p>}
          {candidate && (
            <div className="stack" aria-label="Checked candidate">
              <strong>{candidate.name}</strong>
              <p>{candidate.description}</p>
              <InspectionText label="Candidate source" text={candidate.source} />
              {state?.selected && candidate.revision !== state.selected.revision.revision && (
                <details>
                  <summary aria-label="View selected call source" title="View selected call source">
                    <ActionLabel short="Current" full="View selected call source" />
                  </summary>
                  <InspectionText
                    label="Selected call source"
                    text={state.selected.revision.source}
                  />
                </details>
              )}
              <PresetField
                label="Run with"
                value={actionPreset}
                presets={writePresets}
                disabled={!canEditCall}
                onChange={(value) => edit({ actionPreset: value })}
              />
              <p className="small muted standard-only">
                Per page: up to three model calls in five minutes.
              </p>
              {!alreadyLoaded && (
                <p className="small muted">Saving loads local code with your OS permissions.</p>
              )}
              <button
                type="button"
                className="btn primary"
                aria-label={alreadyLoaded ? 'Selected' : 'Save and select'}
                title="Save and select"
                disabled={
                  !canEditCall || !writePresets.some((p) => p.id === actionPreset) || alreadyLoaded
                }
                onClick={() =>
                  void request({
                    action: 'load',
                    revision: candidate.revision,
                    presetId: actionPreset,
                  })
                }
              >
                <ActionLabel
                  short={alreadyLoaded ? 'Selected' : 'Save & select'}
                  full={alreadyLoaded ? 'Selected' : 'Save and select'}
                />
              </button>
            </div>
          )}
          <details>
            <summary aria-label="Local module and recovery" title="Local module and recovery">
              <ActionLabel short="Recovery" full="Local module and recovery" />
            </summary>
            <div className="stack settings-disclosure">
              <label className="field">
                Module file path
                <input
                  aria-label="Module file path"
                  value={path}
                  maxLength={ACTION_FORM_LIMITS.path}
                  onChange={(e) => edit({ path: e.target.value })}
                  placeholder="/absolute/path/call.ts"
                />
              </label>
              <button
                type="button"
                className="btn"
                disabled={!canEditCall || !path.trim()}
                onClick={() => void request({ action: 'file', path })}
                aria-label="Check file"
                title="Check file"
              >
                <ActionLabel short="Check" full="Check file" />
              </button>
              <p className="small muted standard-only">
                Checking stages the file for review. Save and select loads it.
              </p>
              {state?.previous && (
                <button
                  type="button"
                  className="btn"
                  disabled={disabled}
                  onClick={() => void request({ action: 'restore' })}
                  aria-label="Restore previous call"
                  title="Restore previous call"
                >
                  <ActionLabel short="Restore" full="Restore previous call" />
                </button>
              )}
              {(state?.selected || state?.blocked) && (
                <button
                  type="button"
                  className="btn"
                  disabled={disabled}
                  onClick={() => void request({ action: 'builtin' })}
                  aria-label="Use Summarize"
                  title="Use Summarize"
                >
                  <ActionLabel short="Summarize" full="Use Summarize" />
                </button>
              )}
              {state?.raw && (
                <InspectionText label="Builder response · may be incomplete" text={state.raw} />
              )}
              <p className="small muted standard-only">Optional helper setup:</p>
              <InspectionText
                label="Setup command"
                text={`node scripts/setup.mts --components actions --extension-id ${chrome.runtime.id}`}
              />
            </div>
          </details>
        </div>
      </details>
    </div>
  );
}
