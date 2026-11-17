import { connectionCapabilities } from '../../native/shared-presets-contract.mts';
import { catalogIssue } from '../../native/connections-contract.mts';
import type { ModelPreset, Configuration } from '../configuration/definition';
import type { SettingsEdit } from '../settings/draft';
import { useConnectionCatalog } from './useConnectionCatalog';
import type { PlanSettingsState } from './usePlanSettings';
import { ChatGPTPlanSettings } from './ChatGPTPlanSettings';
import { CHROME_AI_RETIRED_MESSAGE } from '../providers/retired-provider';
import {
  DrawPresetFields,
  SpeakPresetFields,
  ManagedPlanPresetFields,
  ApiPresetFields,
} from './PresetFields';

type PresetEdit = Extract<
  SettingsEdit,
  {
    type:
      | 'select-preset'
      | 'add-preset'
      | 'preset-name'
      | 'preset-connection'
      | 'preset-local-provider'
      | 'preset'
      | 'preset-profile'
      | 'remove-preset';
  }
>;

export function PresetSettings({
  presets,
  selectedPresetId,
  selectedPreset,
  settings,
  remote,
  plan,
  visible,
  saved,
  locked,
  testing,
  planBusy,
  edit,
  search,
  clearTest,
  test,
  onSpeechBusy,
  openConnections,
}: {
  presets: ModelPreset[];
  selectedPresetId: string;
  selectedPreset: ModelPreset | undefined;
  settings: Pick<
    Configuration,
    'connections' | 'profiles' | 'connectionProfiles' | 'sharedCredentials'
  >;
  remote: Configuration['openaiCompatible'];
  plan: PlanSettingsState;
  visible: boolean;
  saved: boolean;
  locked: boolean;
  testing: boolean;
  planBusy: boolean;
  edit: (edit: PresetEdit) => void;
  search: { value: string; change: (value: string) => void };
  clearTest: () => void;
  test: (mode: 'endpoint' | 'generation') => void;
  onSpeechBusy: (busy: boolean) => void;
  openConnections: () => void;
}) {
  const { value: presetSearch, change: setPresetSearch } = search;
  const selectedConnection = settings.connections.find(
    (p) => p.key === selectedPreset?.connectionKey,
  );
  const localConnection =
    settings.sharedCredentials === undefined && selectedPreset?.provider === 'openai-compatible'
      ? (settings.profiles?.find(
          (p) =>
            p.id ===
            (settings.connectionProfiles?.[selectedPreset.connectionKey ?? ''] ||
              selectedPreset.profileId),
        )?.config ?? remote)
      : undefined;
  const connectionCatalog = useConnectionCatalog(
    selectedConnection?.key,
    visible && (settings.sharedCredentials === 'saul' || !!localConnection),
    localConnection,
  );
  const modelOptions =
    connectionCatalog.catalog?.models.filter(
      (m) =>
        !m.capabilities.length || m.capabilities.includes(selectedPreset?.capability ?? 'write'),
    ) ?? [];
  const selectedModelIssue =
    selectedPreset && selectedPreset.provider !== 'chatgpt-plan' && !selectedPreset.model.trim()
      ? 'Choose a model in Presets.'
      : settings.sharedCredentials === 'saul'
        ? catalogIssue(connectionCatalog.catalog, selectedPreset?.model ?? '')
        : undefined;
  const presetConnections = settings.connections;
  const currentConnection = selectedConnection;
  const editPreset = (change: Extract<SettingsEdit, { type: 'preset' }>) => {
    edit(change);
    clearTest();
  };
  return (
    <section hidden={!visible} className="settings-section" aria-label="Presets">
      <h2 className="view-title">Presets</h2>
      <div className="settings-models">
        <div className="preset-browser">
          {presets.length > 6 && (
            <input
              className="search"
              aria-label="Find a preset"
              placeholder="Search"
              value={presetSearch}
              onChange={(e) => setPresetSearch(e.target.value)}
            />
          )}
          <div className="preset-list" aria-label="Model presets">
            {presets
              .filter((p) => p.name.toLocaleLowerCase().includes(presetSearch.toLocaleLowerCase()))
              .map((p) => (
                <button
                  type="button"
                  key={p.id}
                  aria-pressed={p.id === selectedPresetId}
                  disabled={locked}
                  onClick={() => {
                    edit({ type: 'select-preset', id: p.id });
                    clearTest();
                  }}
                >
                  {p.name}
                </button>
              ))}
          </div>
          {!presets.some((p) =>
            p.name.toLocaleLowerCase().includes(presetSearch.toLocaleLowerCase()),
          ) && <p role="status">No matching presets.</p>}
          <button
            className="btn"
            aria-label="Add preset"
            disabled={locked || presets.length >= 32}
            onClick={() => {
              edit({ type: 'add-preset', id: crypto.randomUUID() });
              setPresetSearch('');
            }}
          >
            +
          </button>
        </div>
        <div className="stack preset-editor">
          <div className="compact-preset row">
            <label className="field grow">
              Preset
              <select
                aria-label="Preset"
                value={selectedPresetId}
                disabled={locked}
                onChange={(e) => {
                  edit({ type: 'select-preset', id: e.target.value });
                  clearTest();
                }}
              >
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="btn"
              aria-label="Add preset"
              disabled={locked || presets.length >= 32}
              onClick={() => edit({ type: 'add-preset', id: crypto.randomUUID() })}
            >
              +
            </button>
          </div>
          {selectedPreset && (
            <fieldset className="stack settings-fields" disabled={testing}>
              <label className="field">
                Preset name
                <input
                  maxLength={80}
                  value={selectedPreset.name}
                  disabled={locked}
                  onChange={(e) => edit({ type: 'preset-name', name: e.target.value })}
                />
              </label>
              <label className="field">
                Connection
                <select
                  aria-label="Connection"
                  disabled={locked}
                  value={
                    selectedPreset.connectionKey ||
                    (selectedPreset.provider === 'chatgpt-plan'
                      ? 'gpt-plan'
                      : selectedPreset.provider)
                  }
                  onChange={(e) => {
                    if (presetConnections.some((p) => p.key === e.target.value))
                      edit({ type: 'preset-connection', key: e.target.value });
                    else
                      edit({
                        type: 'preset-local-provider',
                        provider: e.target.value as 'openai-compatible' | 'chrome-ai',
                      });
                  }}
                >
                  {presetConnections.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.name}
                    </option>
                  ))}
                  <option value="openai-compatible">API connection</option>
                  {selectedPreset.connectionKey && !currentConnection && (
                    <option value={selectedPreset.connectionKey} disabled>
                      {selectedPreset.connectionKey} · unavailable
                    </option>
                  )}
                  {selectedPreset.provider === 'chrome-ai' && (
                    <option value="chrome-ai" disabled>
                      Chrome on-device AI (retired)
                    </option>
                  )}
                </select>
              </label>
              {selectedModelIssue && (
                <p className="notice error" role="alert">
                  {selectedModelIssue}
                </p>
              )}
              {connectionCatalog.catalog?.error && connectionCatalog.catalog.fetchedAt > 0 && (
                <p className="notice" role="status">
                  {connectionCatalog.catalog.error} Last known models are shown.
                </p>
              )}
              <label className="field">
                Capability
                <select
                  aria-label="Capability"
                  value={selectedPreset.capability ?? 'write'}
                  disabled={locked}
                  onChange={(e) =>
                    editPreset({
                      type: 'preset',
                      patch: {
                        capability: e.target.value as 'write' | 'draw' | 'speak',
                        model:
                          connectionCatalog.catalog?.models.find((m) =>
                            m.capabilities.includes(e.target.value as 'write' | 'draw' | 'speak'),
                          )?.id ?? '',
                      },
                    })
                  }
                >
                  <option value="write">Write</option>
                  <option
                    value="draw"
                    disabled={
                      !currentConnection ||
                      !connectionCapabilities(currentConnection).includes('draw')
                    }
                  >
                    Draw
                  </option>
                  <option
                    value="speak"
                    disabled={
                      !currentConnection ||
                      !connectionCapabilities(currentConnection).includes('speak')
                    }
                  >
                    Speak
                    {!currentConnection ||
                    !connectionCapabilities(currentConnection).includes('speak')
                      ? ' · requires OpenAI API'
                      : ''}
                  </option>
                </select>
              </label>
              {selectedPreset.capability === 'draw' ? (
                <DrawPresetFields
                  selectedPreset={selectedPreset}
                  modelOptions={modelOptions}
                  editPreset={editPreset}
                  locked={locked}
                  loading={connectionCatalog.loading}
                />
              ) : selectedPreset.capability === 'speak' ? (
                <SpeakPresetFields
                  selectedPreset={selectedPreset}
                  modelOptions={modelOptions}
                  editPreset={editPreset}
                  locked={locked}
                  visible={visible}
                  saved={saved}
                  previewDisabled={testing || planBusy || !!selectedModelIssue}
                  onBusyChange={onSpeechBusy}
                />
              ) : selectedPreset.provider === 'chatgpt-plan' &&
                settings.sharedCredentials === 'saul' ? (
                <ManagedPlanPresetFields
                  selectedPreset={selectedPreset}
                  modelOptions={modelOptions}
                  editPreset={editPreset}
                />
              ) : selectedPreset.provider === 'chatgpt-plan' ? (
                <ChatGPTPlanSettings
                  plan={plan}
                  mode="preset"
                  visible={visible}
                  disabled={testing}
                  test={() => test('generation')}
                />
              ) : selectedPreset.provider === 'chrome-ai' ? (
                <p className="notice">{CHROME_AI_RETIRED_MESSAGE}</p>
              ) : (
                <ApiPresetFields
                  selectedPreset={selectedPreset}
                  modelOptions={modelOptions}
                  editPreset={editPreset}
                  profiles={settings.profiles}
                  selectProfile={(id) => edit({ type: 'preset-profile', id })}
                  fallbackTemperature={remote.temperature}
                  testing={testing}
                  test={test}
                />
              )}
              <div className="row between">
                <button className="btn quiet" onClick={() => openConnections()}>
                  Connections
                </button>
                <button
                  className="btn danger"
                  aria-label="Remove preset"
                  disabled={locked || presets.length <= 1}
                  onClick={() => edit({ type: 'remove-preset' })}
                >
                  Remove
                </button>
              </div>
            </fieldset>
          )}
        </div>
      </div>
    </section>
  );
}
