import { connectionCapabilities, SPEECH_VOICES } from '../../native/shared-presets-contract.mts';
import { ConnectionSettings, ConnectionPresetWarnings } from './ConnectionSettings';
import { NativeBridge } from './NativeBridge';
import { StandaloneConnectionSettings } from './StandaloneConnectionSettings';
import { SharedCredentialSettings } from './SharedCredentialSettings';
import { useConnectionCatalog } from './useConnectionCatalog';
import { catalogIssue } from '../../native/connections-contract.mts';
import { usePlanSettings } from './usePlanSettings';
import { SpeechTest } from './SpeechTest';
import { ActionLabel } from '../surface/ActionLabel';
import { ChatGPTPlanSettings } from './ChatGPTPlanSettings';
import { useEffect, useState } from 'react';
import type { UserSettings } from '../types';
import { useSettingsDraft } from './useSettingsDraft';
import { useProviderTest } from './useProviderTest';
import { CHROME_AI_RETIRED_MESSAGE } from '../models/retired-provider';
import { configurationFor } from '../models/configuration';
import { RecipeSettings } from './RecipeSettings';
import { SUMMARY_ACTION_ID, SUMMARY_CLOSE_ID } from '../digest/actions';
import { ActionSettings } from './ActionSettings';
import type { SettingsSection } from './settings-sections';
import { AppVersion } from './AppVersion';

export function Settings({
  onDirty,
  section = 'overview',
  onSectionChange = () => {},
}: {
  onDirty?: (dirty: boolean) => void;
  section?: SettingsSection;
  onSectionChange?: (section: SettingsSection) => void;
}) {
  const [connectionDirty, setConnectionDirty] = useState(false);
  const draft = useSettingsDraft((value) => onDirty?.(value || connectionDirty));
  const { settings, loaded, dirty, saved, saving, save } = draft;
  const providerTest = useProviderTest();
  const { testing, notice } = providerTest;
  const [presetSearch, setPresetSearch] = useState('');
  const [planBusy, setPlanBusy] = useState(false);
  const [speechBusy, setSpeechBusy] = useState(false);
  const [actionBuilding, setActionBuilding] = useState(false);
  const [summaryShortcut, setSummaryShortcut] = useState('Loading…');
  const [closeShortcut, setCloseShortcut] = useState('Loading…');
  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      void chrome.commands.getAll().then(
        (commands) => {
          if (!disposed) {
            setCloseShortcut(
              commands.find((command) => command.name === SUMMARY_CLOSE_ID)?.shortcut ||
                'Not assigned',
            );
            setSummaryShortcut(
              commands.find((command) => command.name === SUMMARY_ACTION_ID)?.shortcut ||
                'Not assigned',
            );
          }
        },
        () => {
          if (!disposed) {
            setSummaryShortcut('Unavailable');
            setCloseShortcut('Unavailable');
          }
        },
      );
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      disposed = true;
      window.removeEventListener('focus', refresh);
    };
  }, []);
  const configuration = configurationFor(settings);
  const selectedPreset = configuration.presets.find(
    (preset) => preset.id === draft.selectedPresetId,
  );
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
        )?.config ?? settings.openaiCompatible)
      : undefined;
  const connectionCatalog = useConnectionCatalog(
    selectedConnection?.key,
    loaded && section === 'models' && (settings.sharedCredentials === 'saul' || !!localConnection),
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
  const plan = usePlanSettings(
    {
      ...(settings.chatgptPlan ?? { accountId: '', model: '' }),
      ...(selectedConnection?.accountId ? { accountId: selectedConnection.accountId } : {}),
      ...(selectedPreset?.provider === 'chatgpt-plan'
        ? { model: selectedPreset.model, effort: selectedPreset.effort, fast: selectedPreset.fast }
        : {}),
    },
    (value) => {
      if (value.accountId !== settings.chatgptPlan?.accountId)
        draft.edit({ type: 'plan-account', accountId: value.accountId });
      if (selectedPreset?.provider === 'chatgpt-plan')
        draft.edit({
          type: 'preset',
          patch: { model: value.model, effort: value.effort, fast: value.fast },
        });
    },
    setPlanBusy,
    loaded && settings.sharedCredentials === undefined,
    settings.sharedCredentials,
  );
  const error = draft.error || providerTest.error;
  function update(patch: Partial<UserSettings>) {
    draft.edit({ type: 'settings', patch });
    providerTest.clear();
  }
  const editPreset = (patch: Parameters<typeof draft.edit>[0] & { type: 'preset' }) => {
    draft.edit(patch);
    providerTest.clear();
  };
  const test = (mode: 'endpoint' | 'generation') =>
    providerTest.test(mode, settings, selectedPreset?.id);
  const presetConnections = settings.connections;
  const currentConnection = presetConnections.find((p) => p.key === selectedPreset?.connectionKey);
  const locked = testing || planBusy || speechBusy;
  if (!loaded)
    return error ? (
      <div className="stack settings-layout">
        <p role="alert" className="notice error">
          {error}
        </p>
        {draft.canResetInvalidSettings && (
          <button
            type="button"
            className="btn"
            aria-label="Back up and reset settings"
            title="Back up and reset settings"
            disabled={draft.resettingInvalidSettings || draft.blocked}
            onClick={draft.resetInvalidSettings}
          >
            {draft.resettingInvalidSettings ? (
              'Resetting…'
            ) : (
              <ActionLabel short="Reset" full="Back up and reset settings" />
            )}
          </button>
        )}
        <button
          className="btn"
          disabled={saving}
          onClick={draft.reload}
          aria-label="Reload saved settings"
          title="Reload saved settings"
        >
          <ActionLabel short="Reload" full="Reload saved settings" symbol="reload" />
        </button>
      </div>
    ) : (
      <p role="status">Loading settings…</p>
    );
  return (
    <fieldset className="stack settings-layout settings-fields" disabled={saving}>
      {loaded &&
        settings.sharedCredentials === 'saul' &&
        settings.connections.map((connection) => (
          <ConnectionPresetWarnings
            key={connection.key}
            connection={connection}
            omitPresetId={section === 'models' ? selectedPreset?.id : undefined}
            presets={configuration.presets}
            edit={(id) => {
              draft.edit({ type: 'select-preset', id });
              onSectionChange('models');
            }}
          />
        ))}
      {settings.sharedCredentials === undefined ? (
        <StandaloneConnectionSettings
          settings={settings}
          edit={draft.edit}
          plan={plan}
          disabled={locked}
          visible={section === 'connections'}
        />
      ) : (
        <ConnectionSettings
          settings={settings}
          disabled={locked}
          visible={section === 'connections'}
          dirty={dirty}
          commit={draft.commitConnections}
          onDirty={(value) => {
            setConnectionDirty(value);
            onDirty?.(value || dirty);
          }}
          integrations={() => onSectionChange('preferences')}
        />
      )}
      <section hidden={section !== 'models'} className="settings-section" aria-label="Presets">
        <h2 className="view-title">Presets</h2>
        <div className="settings-models">
          <div className="preset-browser">
            {configuration.presets.length > 6 && (
              <input
                className="search"
                aria-label="Find a preset"
                placeholder="Search"
                value={presetSearch}
                onChange={(e) => setPresetSearch(e.target.value)}
              />
            )}
            <div className="preset-list" aria-label="Model presets">
              {configuration.presets
                .filter((p) =>
                  p.name.toLocaleLowerCase().includes(presetSearch.toLocaleLowerCase()),
                )
                .map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    aria-pressed={p.id === draft.selectedPresetId}
                    disabled={locked}
                    onClick={() => {
                      draft.edit({ type: 'select-preset', id: p.id });
                      providerTest.clear();
                    }}
                  >
                    {p.name}
                  </button>
                ))}
            </div>
            {!configuration.presets.some((p) =>
              p.name.toLocaleLowerCase().includes(presetSearch.toLocaleLowerCase()),
            ) && <p role="status">No matching presets.</p>}
            <button
              className="btn"
              aria-label="Add preset"
              disabled={locked || configuration.presets.length >= 32}
              onClick={() => {
                draft.edit({ type: 'add-preset', id: crypto.randomUUID() });
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
                  value={draft.selectedPresetId}
                  disabled={locked}
                  onChange={(e) => {
                    draft.edit({ type: 'select-preset', id: e.target.value });
                    providerTest.clear();
                  }}
                >
                  {configuration.presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="btn"
                aria-label="Add preset"
                disabled={locked || configuration.presets.length >= 32}
                onClick={() => draft.edit({ type: 'add-preset', id: crypto.randomUUID() })}
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
                    onChange={(e) => draft.edit({ type: 'preset-name', name: e.target.value })}
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
                        draft.edit({ type: 'preset-connection', key: e.target.value });
                      else
                        draft.edit({
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
                  <div className="stack">
                    <label className="field">
                      Image model
                      <select
                        aria-label="Image model"
                        value={selectedPreset.model}
                        disabled={locked}
                        onChange={(e) =>
                          editPreset({ type: 'preset', patch: { model: e.target.value } })
                        }
                      >
                        {!modelOptions.some((m) => m.id === selectedPreset.model) && (
                          <option value={selectedPreset.model}>
                            {selectedPreset.model || 'Choose a model'} ·{' '}
                            {connectionCatalog.loading ? 'loading' : 'unavailable'}
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
                            {{
                              size: ['1024x1024', '1536x1024', '1024x1536'],
                              quality: ['low', 'medium', 'high'],
                              outputFormat: ['png', 'gif'],
                            }[key].map((v) => (
                              <option key={v}>{v}</option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </details>
                  </div>
                ) : selectedPreset.capability === 'speak' ? (
                  <>
                    <label className="field">
                      Model
                      <select
                        aria-label="Speech model"
                        disabled={locked}
                        value={selectedPreset.model}
                        onChange={(e) =>
                          editPreset({ type: 'preset', patch: { model: e.target.value } })
                        }
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
                    {section === 'models' && (
                      <SpeechTest
                        key={selectedPreset.id}
                        preset={selectedPreset}
                        saved={!dirty}
                        disabled={testing || planBusy || !!selectedModelIssue}
                        onBusyChange={setSpeechBusy}
                      />
                    )}
                  </>
                ) : selectedPreset.provider === 'chatgpt-plan' &&
                  settings.sharedCredentials === 'saul' ? (
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
                                choice?.efforts.find((e) =>
                                  ['none', 'minimal', 'low'].includes(e),
                                ) ??
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
                            onChange={(e) =>
                              editPreset({ type: 'preset', patch: { effort: e.target.value } })
                            }
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
                              disabled={
                                !modelOptions.find((m) => m.id === selectedPreset.model)?.fastTier
                              }
                            >
                              Fast
                            </option>
                          </select>
                        </label>
                      </div>
                    </details>
                  </div>
                ) : selectedPreset.provider === 'chatgpt-plan' ? (
                  <ChatGPTPlanSettings
                    plan={plan}
                    mode="preset"
                    visible={section === 'models'}
                    disabled={testing}
                    test={() => test('generation')}
                  />
                ) : selectedPreset.provider === 'chrome-ai' ? (
                  <p className="notice">{CHROME_AI_RETIRED_MESSAGE}</p>
                ) : (
                  <>
                    {!selectedPreset.connectionKey && (
                      <label className="field">
                        Connection
                        <select
                          aria-label="Preset connection"
                          value={selectedPreset.profileId ?? ''}
                          onChange={(e) =>
                            draft.edit({ type: 'preset-profile', id: e.target.value })
                          }
                        >
                          {settings.profiles?.map((p) => (
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
                        onChange={(e) =>
                          editPreset({ type: 'preset', patch: { model: e.target.value } })
                        }
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
                          Temperature:{' '}
                          {selectedPreset.temperature ?? settings.openaiCompatible.temperature}
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={
                              selectedPreset.temperature ?? settings.openaiCompatible.temperature
                            }
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
                )}
                <div className="row between">
                  <button className="btn quiet" onClick={() => onSectionChange('connections')}>
                    Connections
                  </button>
                  <button
                    className="btn danger"
                    aria-label="Remove preset"
                    disabled={locked || configuration.presets.length <= 1}
                    onClick={() => draft.edit({ type: 'remove-preset' })}
                  >
                    Remove
                  </button>
                </div>
              </fieldset>
            )}
          </div>
        </div>
      </section>
      <section hidden={section !== 'calls'} className="settings-section" aria-label="Calls">
        <h2 className="view-title">Calls</h2>
        <ActionSettings
          presets={configuration.presets}
          summaryPresetId={settings.summaryPresetId ?? ''}
          onSummaryPresetChange={(id) => update({ summaryPresetId: id || undefined })}
          settingsDirty={dirty}
          onBuildingChange={setActionBuilding}
        >
          <label className="field">
            PDF processing
            <select
              aria-label="PDF processing"
              value={settings.summaryPdfProcessing ?? 'attachment'}
              onChange={(event) =>
                update({ summaryPdfProcessing: event.target.value as 'attachment' | 'local' })
              }
            >
              <option value="attachment">PDF URL attachment (server)</option>
              <option value="local">Local parsing · send text</option>
            </select>
          </label>
          <details className="standard-only">
            <summary>About PDF processing</summary>
            <p className="small muted">
              PDF URL attachment requires a ChatGPT plan preset and a link OpenAI can open without
              your browser sign-in. Local parsing sends extracted text only. This setting applies to
              new calls and Run again; Retry keeps the saved method.
            </p>
          </details>
        </ActionSettings>
      </section>
      <section
        hidden={section !== 'overview' && section !== 'reading'}
        className="settings-section"
        aria-label={section === 'overview' ? 'Overview' : 'Actions'}
      >
        <h2 className="view-title">{section === 'overview' ? 'Settings' : 'Actions'}</h2>
        <div className="settings-pair">
          <label className="field">
            Default action
            <select
              aria-label="Default action"
              value={configuration.selectedRecipeId}
              onChange={(event) => draft.edit({ type: 'default-recipe', id: event.target.value })}
            >
              {configuration.recipes.map((recipe) => (
                <option key={recipe.id} value={recipe.id}>
                  {recipe.name}
                  {configuration.presets.length > 1 &&
                    ` · ${configuration.presets.find((preset) => preset.id === recipe.presetId)?.name || 'Unavailable preset'}`}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Response language
            <select
              aria-label="Response language"
              value={settings.responseLanguage || ''}
              onChange={(e) => update({ responseLanguage: e.target.value })}
            >
              <option value="">Match selected text</option>
              <option value="English">English</option>
              <option value="Chinese">中文</option>
              <option value="Spanish">Español</option>
              <option value="Japanese">日本語</option>
              <option value="French">Français</option>
              <option value="German">Deutsch</option>
            </select>
          </label>
        </div>
        <div hidden={section !== 'overview'} className="settings-overview">
          <AppVersion />
          <button className="settings-link" onClick={() => onSectionChange('models')}>
            <span>Presets</span>
            <span>
              {configuration.presets.length}
              <span aria-hidden="true"> ›</span>
            </span>
          </button>
          <button className="settings-link" onClick={() => onSectionChange('reading')}>
            <span>Actions</span>
            <span>
              {configuration.recipes.length}
              <span aria-hidden="true"> ›</span>
            </span>
          </button>
          <button className="settings-link" onClick={() => onSectionChange('calls')}>
            <span>Calls</span>
            <span aria-hidden="true">›</span>
          </button>
        </div>
        <div hidden={section !== 'reading'} className="stack">
          <details>
            <summary aria-label="Include with selected text" title="Include with selected text">
              <ActionLabel short="Context" full="Include with selected text" />
            </summary>
            <div className="stack settings-disclosure">
              <p className="small muted standard-only">
                Checked page information is sent to your model with the selection.
              </p>
              {(
                [
                  ['includeContainingParagraph', 'Surrounding paragraph'],
                  ['includeContainingHeading', 'Section heading'],
                  ['includePageMetadata', 'Page title and URL'],
                ] as const
              ).map(([key, label]) => (
                <label className="toggle" key={key}>
                  {label}
                  <input
                    type="checkbox"
                    checked={settings.contextPolicy[key]}
                    onChange={(e) =>
                      update({
                        contextPolicy: { ...settings.contextPolicy, [key]: e.target.checked },
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </details>
          <RecipeSettings
            configuration={configuration}
            recipeId={draft.selectedRecipeId}
            onEdit={draft.edit}
          />
        </div>
      </section>
      <details hidden={section !== 'preferences'} className="panel">
        <summary>Integrations</summary>
        <SharedCredentialSettings
          owner={settings.sharedCredentials}
          disabled={locked || dirty}
          visible={section === 'preferences'}
          change={draft.setCredentialOwner}
        />
        <p className="small">
          The signed credential helper manages shared sign-in and keys. Install or update it if
          connections are unavailable.
        </p>
        <NativeBridge />
        {settings.sharedCredentials === undefined && (
          <details>
            <summary>ChatGPT helper setup</summary>
            <code className="code">
              pnpm native:install --chatgpt --extension-id {chrome.runtime.id}
            </code>
          </details>
        )}
      </details>
      <details hidden={section !== 'preferences'} className="panel shortcuts">
        <summary>Shortcuts</summary>
        <dl>
          <div>
            <dt>Call Saul</dt>
            <dd>{summaryShortcut}</dd>
          </div>
          <div>
            <dt>Close summary panel</dt>
            <dd>{closeShortcut}</dd>
          </div>
          <div>
            <dt>Explain selection</dt>
            <dd>⌘ / Ctrl + Enter</dd>
          </div>
          <div>
            <dt>Stop active explanation</dt>
            <dd>⌘ / Ctrl + .</dd>
          </div>
          <div>
            <dt>Dismiss</dt>
            <dd>Escape</dd>
          </div>
          <div>
            <dt>Settings</dt>
            <dd>⌘ / Ctrl + ,</dd>
          </div>
          <div>
            <dt>Explain selection</dt>
            <dd>Alt + Shift + E</dd>
          </div>
          <div>
            <dt>Page explanations</dt>
            <dd>Alt + Shift + L</dd>
          </div>
        </dl>
        <button
          type="button"
          className="btn quiet"
          onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}
          aria-label="Configure Chrome shortcuts"
          title="Configure Chrome shortcuts"
        >
          <ActionLabel short="Configure" full="Configure Chrome shortcuts" />
        </button>
      </details>
      <div
        className="settings-save"
        hidden={
          !dirty &&
          !saved &&
          !error &&
          !notice &&
          !testing &&
          !planBusy &&
          !speechBusy &&
          !actionBuilding &&
          (section === 'preferences' || section === 'connections')
        }
      >
        {testing && (
          <div className="row">
            <span role="status" className="small muted">
              Testing provider…
            </span>
            <button
              className="btn"
              onClick={providerTest.stop}
              aria-label="Stop test"
              title="Stop test"
            >
              <ActionLabel short="Stop" full="Stop test" />
            </button>
          </div>
        )}
        {actionBuilding && section !== 'calls' && (
          <div className="row">
            <span role="status">Building call…</span>
            <button className="btn" onClick={() => onSectionChange('calls')}>
              Calls
            </button>
          </div>
        )}
        {planBusy && (
          <div className="row">
            <span role="status">
              {plan.busy
                ? {
                    accounts: 'Refreshing accounts…',
                    login: 'Complete sign-in in the opened tab.',
                    logout: 'Signing out…',
                    models: 'Refreshing available models…',
                  }[plan.busy]
                : 'Account operation in progress.'}
            </span>
            <button className="btn" onClick={() => onSectionChange('connections')}>
              Connections
            </button>
          </div>
        )}
        {plan.busy && plan.busy !== 'logout' && (
          <button className="btn" onClick={() => plan.controller.current?.abort()}>
            Cancel
          </button>
        )}
        {plan.notice && (
          <p className="notice" role="status">
            {plan.notice}
          </p>
        )}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {draft.recoveryNotice && (
          <p className="notice" role="status">
            {draft.recoveryNotice}
          </p>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        <div className="row between">
          <span className="small muted" role="status">
            {dirty ? 'Unsaved changes' : saved ? 'Saved' : 'Configuration'}
          </span>
          <div className="row">
            {draft.blocked && (
              <button
                className="btn"
                disabled={testing || saving || planBusy || speechBusy}
                onClick={() => {
                  providerTest.clear();
                  void draft.reload();
                }}
                aria-label="Reload saved settings"
                title="Reload saved settings"
              >
                <ActionLabel short="Reload" full="Reload saved settings" symbol="reload" />
              </button>
            )}
            <button
              className="btn primary"
              disabled={testing || saving || planBusy || speechBusy || draft.blocked}
              onClick={save}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </fieldset>
  );
}
