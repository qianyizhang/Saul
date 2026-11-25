import { callChoiceKey } from '../../../shared/model/custom-call.ts';
import { ActionLabel } from '../../ui/ActionLabel';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ModelPreset } from '../../../shared/model/presets.ts';
import { CALL_FORM_LIMITS, type CallEditRequest, type CallEditorState } from '../contract';
import { editCall } from '../client';
import { InspectionText } from '../../ui/InspectionText';
import {
  createStatusObserver,
  type StatusObserver,
  type StatusSnapshot,
} from '../../observation/status-observer';

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
      prompt: CALL_FORM_LIMITS.prompt,
      builderPreset: CALL_FORM_LIMITS.presetId,
      actionPreset: CALL_FORM_LIMITS.presetId,
      path: CALL_FORM_LIMITS.path,
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

export function CallSettings({
  presets,
  visible,
  settingsDirty,
  onBuildingChange,
  children,
}: {
  presets: ModelPreset[];
  visible: boolean;
  settingsDirty: boolean;
  onBuildingChange?: (building: boolean) => void;
  children: ReactNode;
}) {
  const writePresets = presets.filter(
    (p) => (p.capability ?? 'write') === 'write' && p.provider !== 'chrome-ai',
  );
  const [status, setStatus] = useState<StatusSnapshot<CallEditorState>>({});
  const { value: state, error: readError } = status;
  const [form, setForm] = useState(readForm);
  const { prompt = '', builderPreset = '', actionPreset = '', path = '' } = form;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const observer = useRef<StatusObserver<CallEditorState> | null>(null);
  const formSeeded = useRef(false);
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
    const current = createStatusObserver({
      read: () => editCall({ action: 'status' }),
      shouldPoll: (next) => !!next.building,
      onSnapshot: setStatus,
    });
    observer.current = current;
    return () => {
      observer.current = null;
      current.dispose();
    };
  }, []);
  useEffect(() => {
    if (visible) void observer.current?.refresh();
  }, [visible]);
  const builtinPresetId = state?.builtinPresetId;
  useEffect(() => {
    if (!state || formSeeded.current) return;
    formSeeded.current = true;
    setForm((current) => ({
      prompt: state.prompt || '',
      actionPreset: state.selected?.presetId || builtinPresetId || writePresets[0]?.id || '',
      builderPreset: builtinPresetId || writePresets[0]?.id || '',
      ...current,
    }));
  }, [state, builtinPresetId, writePresets]);
  async function request(message: Exclude<CallEditRequest, { action: 'status' }>) {
    const current = observer.current;
    if (!current) return;
    setBusy(true);
    setError('');
    try {
      const next = await editCall(message);
      if (observer.current === current) void current.invalidate(next);
    } catch (e) {
      if (observer.current === current) {
        setError((e as Error).message);
        void current.invalidate();
      }
    } finally {
      if (observer.current === current) setBusy(false);
    }
  }
  const building = state?.building;
  useEffect(() => {
    onBuildingChange?.(!!building);
    return () => onBuildingChange?.(false);
  }, [building, onBuildingChange]);
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
            value={state.selected ? callChoiceKey(state.selected) : ''}
            onChange={(event) => {
              const choice = state.library?.find((c) => callChoiceKey(c) === event.target.value);
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
              const key = callChoiceKey(choice);
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
          value={builtinPresetId ?? ''}
          presets={writePresets}
          onChange={(presetId) => {
            if (presetId && state.choiceSource)
              void request({ action: 'builtin-preset', presetId, baseline: state.choiceSource });
          }}
          disabled={!canEditCall}
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
      {readError && (
        <div className="row between notice error">
          <span role="alert">Could not read call status: {readError}</span>
          <button type="button" className="btn" onClick={() => void observer.current?.refresh()}>
            Refresh status
          </button>
        </div>
      )}
      <details>
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
              maxLength={CALL_FORM_LIMITS.prompt}
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
                  maxLength={CALL_FORM_LIMITS.path}
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
              {(state?.selected || state?.canRecover) && (
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
