import {
  DEFAULT_PROVIDERS,
  providerCapabilities,
  SPEECH_VOICES,
} from '../../native/shared-presets-contract.mts';
import { ProviderSettings } from './ProviderSettings';
import { usePlanSettings } from './usePlanSettings';
import { SpeechTest } from './SpeechTest';
import { ActionLabel } from '../surface/ActionLabel';
import { ChatGPTPlanSettings } from './ChatGPTPlanSettings';
import { useEffect, useState } from 'react';
import type { UserSettings } from '../types';
import { useSettingsDraft } from './useSettingsDraft';
import { useProviderTest } from './useProviderTest';
import { CHROME_AI_ENABLED, CHROME_AI_DISABLED_MESSAGE } from '../models/chrome-ai';
import { configurationFor } from '../models/configuration';
import { RecipeSettings } from './RecipeSettings';
import { SUMMARY_ACTION_ID, SUMMARY_CLOSE_ID } from '../digest/actions';
import { ActionSettings } from './ActionSettings';
import type { SettingsSection } from './settings-sections';

export function Settings({
  onDirty,
  section = 'overview',
  onSectionChange = () => {},
}: {
  onDirty?: (dirty: boolean) => void;
  section?: SettingsSection;
  onSectionChange?: (section: SettingsSection) => void;
}) {
  const draft = useSettingsDraft(onDirty);
  const { settings, loaded, dirty, saved, saving, save } = draft;
  const providerTest = useProviderTest(settings.activeProvider);
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
  const plan = usePlanSettings(
    {
      ...(settings.chatgptPlan ?? { accountId: '', model: '' }),
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
    loaded,
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
  const test = (mode: 'endpoint' | 'generation' | 'prepare') =>
    providerTest.test(mode, settings, selectedPreset?.id);
  const presetProviders = settings.providers ?? DEFAULT_PROVIDERS;
  const currentProvider = presetProviders.find((p) => p.key === selectedPreset?.providerKey);
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
          <ActionLabel short="Reload" full="Reload saved settings" />
        </button>
      </div>
    ) : (
      <p role="status">Loading settings…</p>
    );
  return (
    <fieldset className="stack settings-layout settings-fields" disabled={saving}>
      <ProviderSettings
        settings={settings}
        edit={draft.edit}
        plan={plan}
        disabled={locked}
        visible={section === 'connections'}
      />
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
                  Provider
                  <select
                    aria-label="Provider"
                    disabled={locked}
                    value={
                      selectedPreset.providerKey ||
                      (selectedPreset.provider === 'chatgpt-plan'
                        ? 'gpt-plan'
                        : selectedPreset.provider)
                    }
                    onChange={(e) => {
                      if (presetProviders.some((p) => p.key === e.target.value))
                        draft.edit({ type: 'preset-provider', key: e.target.value });
                      else
                        draft.edit({
                          type: 'preset-local-provider',
                          provider: e.target.value as 'openai-compatible' | 'chrome-ai',
                        });
                    }}
                  >
                    {presetProviders.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.name}
                      </option>
                    ))}
                    <option value="openai-compatible">API connection</option>
                    {selectedPreset.providerKey && !currentProvider && (
                      <option value={selectedPreset.providerKey} disabled>
                        {selectedPreset.providerKey} · unavailable
                      </option>
                    )}
                    <option value="chrome-ai" disabled={!CHROME_AI_ENABLED}>
                      Chrome on-device AI{CHROME_AI_ENABLED ? '' : ' (temporarily disabled)'}
                    </option>
                  </select>
                </label>
                <label className="field">
                  Capability
                  <select
                    aria-label="Capability"
                    value={selectedPreset.capability ?? 'write'}
                    disabled={locked || selectedPreset.capability === 'draw'}
                    onChange={(e) =>
                      editPreset({
                        type: 'preset',
                        patch: { capability: e.target.value as 'write' | 'speak' },
                      })
                    }
                  >
                    <option value="write">Write</option>
                    <option value="draw" disabled>
                      Draw · edit in EZ
                    </option>
                    <option
                      value="speak"
                      disabled={
                        !currentProvider || !providerCapabilities(currentProvider).includes('speak')
                      }
                    >
                      Speak
                      {!currentProvider || !providerCapabilities(currentProvider).includes('speak')
                        ? ' · requires OpenAI API'
                        : ''}
                    </option>
                  </select>
                </label>
                {selectedPreset.capability === 'draw' ? (
                  <div>
                    <p role="status">
                      Draw preset · edit image settings in EZ. Saul currently runs Write actions.
                    </p>
                    <dl className="saul-metadata">
                      <dt>Model</dt>
                      <dd>{selectedPreset.model}</dd>
                      <dt>Size</dt>
                      <dd>{selectedPreset.imageOptions?.size || '1024x1024'}</dd>
                      <dt>Quality</dt>
                      <dd>{selectedPreset.imageOptions?.quality || 'low'}</dd>
                    </dl>
                  </div>
                ) : selectedPreset.capability === 'speak' ? (
                  <>
                    <label className="field">
                      Model
                      <input
                        aria-label="Speech model"
                        disabled={locked}
                        value={selectedPreset.model}
                        onChange={(e) =>
                          editPreset({ type: 'preset', patch: { model: e.target.value } })
                        }
                      />
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
                        disabled={testing || planBusy}
                        onBusyChange={setSpeechBusy}
                      />
                    )}
                  </>
                ) : selectedPreset.provider === 'chatgpt-plan' ? (
                  <ChatGPTPlanSettings
                    plan={plan}
                    mode="preset"
                    visible={section === 'models'}
                    disabled={testing}
                    test={() => test('generation')}
                  />
                ) : selectedPreset.provider === 'chrome-ai' ? (
                  <p className="notice">{CHROME_AI_DISABLED_MESSAGE}</p>
                ) : (
                  <>
                    {!selectedPreset.providerKey && (
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
                        value={selectedPreset.model}
                        onChange={(e) =>
                          editPreset({ type: 'preset', patch: { model: e.target.value } })
                        }
                      />
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
                    Providers
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
      <section hidden={section !== 'summaries'} className="settings-section" aria-label="Summaries">
        <h3>Summaries</h3>
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
          <summary>Details</summary>
          <p className="small muted">
            PDF URL attachment lets OpenAI read text and page images from the link, without a
            download by Saul. The link must work without your browser sign-in. Local parsing sends
            extracted text only. This setting applies to new summaries and Run again; Retry keeps
            the saved method.
          </p>
        </details>
        <ActionSettings
          presets={configuration.presets}
          settingsDirty={dirty}
          onBuildingChange={setActionBuilding}
        />
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
          <button className="settings-link" onClick={() => onSectionChange('connections')}>
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
          <button className="settings-link" onClick={() => onSectionChange('summaries')}>
            <span>Summaries</span>
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
          !error &&
          !notice &&
          !testing &&
          !planBusy &&
          !speechBusy &&
          !actionBuilding &&
          section === 'preferences'
        }
      >
        {testing && (
          <div className="row">
            <span role="status" className="small muted">
              {providerTest.preparing ? 'Preparing on-device model…' : 'Testing provider…'}
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
        {actionBuilding && section !== 'summaries' && (
          <div className="row">
            <span role="status">Creating action…</span>
            <button className="btn" onClick={() => onSectionChange('summaries')}>
              Summaries
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
              Providers
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
                <ActionLabel short="Reload" full="Reload saved settings" />
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
