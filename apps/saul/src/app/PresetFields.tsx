import { IMAGE_OPTIONS, SPEECH_VOICES } from '../../native/shared-presets-contract.mts';
import type { ConnectionModel } from '../../native/connections-contract.mts';
import type { ModelPreset, Configuration } from '../configuration/definition';
import type { SettingsEdit } from '../settings/draft';
import { ActionLabel } from '../surface/ActionLabel';
import { SpeechTest } from './SpeechTest';

type PresetEdit = (edit: Extract<SettingsEdit, { type: 'preset' }>) => void;
interface ModelFields {
  selectedPreset: ModelPreset;
  modelOptions: ConnectionModel[];
  editPreset: PresetEdit;
}
export function DrawPresetFields({
  selectedPreset,
  modelOptions,
  editPreset,
  locked,
  loading,
}: ModelFields & { locked: boolean; loading: boolean }) {
  return (
    <div className="stack">
      <label className="field">
        Image model
        <select
          aria-label="Image model"
          value={selectedPreset.model}
          disabled={locked}
          onChange={(e) => editPreset({ type: 'preset', patch: { model: e.target.value } })}
        >
          {!modelOptions.some((m) => m.id === selectedPreset.model) && (
            <option value={selectedPreset.model}>
              {selectedPreset.model || 'Choose a model'} · {loading ? 'loading' : 'unavailable'}
            </option>
          )}
          {modelOptions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {!m.capabilities.length ? ' · capability unverified' : ''}
            </option>
          ))}
        </select>
      </label>
      <details>
        <summary>Image settings</summary>
        {(['size', 'quality', 'outputFormat'] as const).map((key) => (
          <label className="field" key={key}>
            {{ size: 'Size', quality: 'Quality', outputFormat: 'Output format' }[key]}
            <select
              aria-label={
                {
                  size: 'Image size',
                  quality: 'Image quality',
                  outputFormat: 'Image output format',
                }[key]
              }
              disabled={locked}
              value={
                selectedPreset.imageOptions?.[key] ??
                { size: '1024x1024', quality: 'low', outputFormat: 'png' }[key]
              }
              onChange={(e) =>
                editPreset({
                  type: 'preset',
                  patch: {
                    imageOptions: {
                      size: '1024x1024',
                      quality: 'low',
                      ...selectedPreset.imageOptions,
                      [key]: e.target.value,
                    },
                  },
                })
              }
            >
              {IMAGE_OPTIONS[key].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        ))}
      </details>
    </div>
  );
}
export function SpeakPresetFields({
  selectedPreset,
  modelOptions,
  editPreset,
  locked,
  visible,
  saved,
  previewDisabled,
  onBusyChange,
}: ModelFields & {
  locked: boolean;
  visible: boolean;
  saved: boolean;
  previewDisabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  return (
    <>
      <label className="field">
        Model
        <select
          aria-label="Speech model"
          disabled={locked}
          value={selectedPreset.model}
          onChange={(e) => editPreset({ type: 'preset', patch: { model: e.target.value } })}
        >
          {!modelOptions.some((m) => m.id === selectedPreset.model) && (
            <option value={selectedPreset.model}>
              {selectedPreset.model || 'Choose a model'} · unavailable
            </option>
          )}
          {modelOptions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {!m.capabilities.length ? ' · capability unverified' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Voice
        <select
          aria-label="Speech voice"
          disabled={locked}
          value={selectedPreset.speechOptions?.voice ?? 'marin'}
          onChange={(e) =>
            editPreset({
              type: 'preset',
              patch: { speechOptions: { voice: e.target.value } },
            })
          }
        >
          {SPEECH_VOICES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
      {visible && (
        <SpeechTest
          key={selectedPreset.id}
          preset={selectedPreset}
          saved={saved}
          disabled={previewDisabled}
          onBusyChange={onBusyChange}
        />
      )}
    </>
  );
}
export function ManagedPlanPresetFields({ selectedPreset, modelOptions, editPreset }: ModelFields) {
  return (
    <div className="stack">
      <label className="field">
        Model
        <select
          aria-label="ChatGPT model"
          value={selectedPreset.model}
          onChange={(event) => {
            const choice = modelOptions.find((m) => m.id === event.target.value);
            editPreset({
              type: 'preset',
              patch: {
                model: event.target.value,
                effort:
                  choice?.efforts.find((e) => ['none', 'minimal', 'low'].includes(e)) ??
                  choice?.defaultEffort ??
                  '',
                fast: false,
              },
            });
          }}
        >
          {!modelOptions.some((m) => m.id === selectedPreset.model) && (
            <option value={selectedPreset.model}>
              {selectedPreset.model || 'Choose a model'} · unavailable
            </option>
          )}
          {modelOptions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {!m.capabilities.length ? ' · capability unverified' : ''}
            </option>
          ))}
        </select>
      </label>
      <details>
        <summary>Options</summary>
        <div className="stack settings-disclosure">
          <label className="field">
            Effort
            <select
              value={selectedPreset.effort ?? ''}
              onChange={(e) => editPreset({ type: 'preset', patch: { effort: e.target.value } })}
            >
              <option value="">Default</option>
              {selectedPreset.effort &&
                !modelOptions
                  .find((m) => m.id === selectedPreset.model)
                  ?.efforts.includes(selectedPreset.effort) && (
                  <option value={selectedPreset.effort}>
                    {selectedPreset.effort} · unavailable
                  </option>
                )}
              {modelOptions
                .find((m) => m.id === selectedPreset.model)
                ?.efforts.map((e) => (
                  <option key={e}>{e}</option>
                ))}
            </select>
          </label>
          <label className="field">
            Speed
            <select
              value={String(!!selectedPreset.fast)}
              onChange={(e) =>
                editPreset({
                  type: 'preset',
                  patch: { fast: e.target.value === 'true' },
                })
              }
            >
              <option value="false">Standard</option>
              <option
                value="true"
                disabled={!modelOptions.find((m) => m.id === selectedPreset.model)?.fastTier}
              >
                Fast
              </option>
            </select>
          </label>
        </div>
      </details>
    </div>
  );
}
export function ApiPresetFields({
  selectedPreset,
  modelOptions,
  editPreset,
  profiles,
  selectProfile,
  fallbackTemperature,
  testing,
  test,
}: ModelFields & {
  profiles: Configuration['profiles'];
  selectProfile: (id: string) => void;
  fallbackTemperature: number;
  testing: boolean;
  test: (mode: 'endpoint' | 'generation') => void;
}) {
  return (
    <>
      {!selectedPreset.connectionKey && (
        <label className="field">
          Connection
          <select
            aria-label="Preset connection"
            value={selectedPreset.profileId ?? ''}
            onChange={(e) => selectProfile(e.target.value)}
          >
            {profiles?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        Model
        <input
          aria-label="Model name"
          list="connection-model-options"
          value={selectedPreset.model}
          onChange={(e) => editPreset({ type: 'preset', patch: { model: e.target.value } })}
        />
        <datalist id="connection-model-options">
          {modelOptions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {!m.capabilities.length ? ' · capability unverified' : ''}
            </option>
          ))}
        </datalist>
      </label>
      <details>
        <summary aria-label="Model options and tests">
          <ActionLabel short="Options" full="Model options and tests" />
        </summary>
        <div className="stack settings-disclosure">
          <label className="field">
            Temperature: {selectedPreset.temperature ?? fallbackTemperature}
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={selectedPreset.temperature ?? fallbackTemperature}
              onChange={(e) =>
                editPreset({
                  type: 'preset',
                  patch: { temperature: Number(e.target.value) },
                })
              }
            />
          </label>
          <div className="row">
            <button
              className="btn"
              disabled={testing}
              onClick={() => test('endpoint')}
              aria-label="Test Connection"
            >
              <ActionLabel short="Check" full="Test Connection" />
            </button>
            <button
              className="btn"
              disabled={testing}
              onClick={() => test('generation')}
              aria-label="Test generation"
            >
              <ActionLabel short="Test" full="Test generation" />
            </button>
          </div>
        </div>
      </details>
    </>
  );
}
