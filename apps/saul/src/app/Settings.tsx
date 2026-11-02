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

const presets = [
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: '' },
];
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
  const { testing, notice, availability } = providerTest;
  const error = draft.error || providerTest.error;
  const [presetSearch, setPresetSearch] = useState('');
  const [visibleKey, setVisibleKey] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
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
  useEffect(() => setVisibleKey(false), [settings.activeProfileId, settings.activeProvider]);
  function update(patch: Partial<UserSettings>) {
    if (patch.activeProfileId || patch.activeProvider) setVisibleKey(false);
    draft.edit({ type: 'settings', patch });
    providerTest.clear();
  }
  function config(patch: Partial<UserSettings['openaiCompatible']>) {
    draft.edit({ type: 'remote', patch });
    providerTest.clear();
  }
  const test = (mode: 'endpoint' | 'generation' | 'prepare') => providerTest.test(mode, settings);
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
      <section hidden={section !== 'models'} className="settings-section" aria-label="Models">
        <h2 className="view-title">Models</h2>
        <p className="small muted standard-only">
          ChatGPT presets are shared with EZ. Accounts and recipes stay in each app.
        </p>
        <div className="settings-models">
          <div className="preset-browser">
            {configuration.presets.length > 6 && (
              <input
                className="search"
                aria-label="Find a preset"
                placeholder="Search"
                value={presetSearch}
                onChange={(event) => setPresetSearch(event.target.value)}
              />
            )}
            <div className="preset-list" aria-label="Model presets">
              {configuration.presets
                .filter((preset) =>
                  preset.name.toLocaleLowerCase().includes(presetSearch.toLocaleLowerCase()),
                )
                .map((preset) => (
                  <button
                    type="button"
                    key={preset.id}
                    aria-pressed={preset.id === draft.selectedPresetId}
                    disabled={testing || planBusy}
                    onClick={() => {
                      draft.edit({ type: 'select-preset', id: preset.id });
                      providerTest.clear();
                    }}
                  >
                    {preset.name}
                  </button>
                ))}
            </div>
            {!configuration.presets.some((preset) =>
              preset.name.toLocaleLowerCase().includes(presetSearch.toLocaleLowerCase()),
            ) && <p role="status">No matching presets.</p>}
            <button
              className="btn"
              aria-label="Add preset"
              title="Add preset"
              disabled={testing || planBusy || configuration.presets.length >= 32}
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
                  disabled={testing || planBusy}
                  value={draft.selectedPresetId}
                  onChange={(event) => {
                    draft.edit({ type: 'select-preset', id: event.target.value });
                    providerTest.clear();
                  }}
                >
                  {configuration.presets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="btn"
                aria-label="Add preset"
                title="Add preset"
                disabled={testing || planBusy || configuration.presets.length >= 32}
                onClick={() => draft.edit({ type: 'add-preset', id: crypto.randomUUID() })}
              >
                +
              </button>
            </div>
            <div className="row">
              <label className="field grow">
                Preset name
                <input
                  maxLength={80}
                  value={selectedPreset?.name || ''}
                  disabled={testing || planBusy}
                  onChange={(event) =>
                    draft.edit({ type: 'preset-name', name: event.target.value })
                  }
                />
              </label>
              <button
                className="btn danger"
                aria-label="Remove preset"
                title="Remove preset"
                disabled={testing || planBusy || configuration.presets.length <= 1}
                onClick={() => draft.edit({ type: 'remove-preset' })}
              >
                Remove
              </button>
            </div>
            <fieldset
              className={`settings-fields ${settings.activeProvider === 'openai-compatible' ? 'api-fields' : ''}`}
              disabled={testing}
            >
              <label className="field">
                AI service
                <select
                  aria-label="AI service"
                  disabled={planBusy}
                  value={settings.activeProvider}
                  onChange={(e) =>
                    update({ activeProvider: e.target.value as UserSettings['activeProvider'] })
                  }
                >
                  <option value="openai-compatible">API connection</option>
                  <option value="chatgpt-plan">ChatGPT plan</option>
                  <option value="chrome-ai" disabled={!CHROME_AI_ENABLED}>
                    Chrome on-device AI{CHROME_AI_ENABLED ? '' : ' (temporarily disabled)'}
                  </option>
                </select>
              </label>
              {settings.activeProvider === 'chatgpt-plan' ? (
                <ChatGPTPlanSettings
                  key={draft.selectedPresetId}
                  visible={section === 'models'}
                  onBusyChange={setPlanBusy}
                  saved={!dirty}
                  value={settings.chatgptPlan || { accountId: '', model: '' }}
                  onChange={(chatgptPlan) => update({ chatgptPlan })}
                  test={() => test('generation')}
                  testing={testing}
                />
              ) : settings.activeProvider === 'chrome-ai' ? (
                !CHROME_AI_ENABLED ? (
                  <p className="notice">{CHROME_AI_DISABLED_MESSAGE}</p>
                ) : (
                  <div className="stack">
                    <p className="muted standard-only">
                      Chrome's built-in Gemini Nano runs locally after a separate model download.
                    </p>
                    <p className="small" role="status">
                      Availability: {availability}.
                    </p>
                    {availability === 'unavailable' && (
                      <p className="notice">
                        Chrome reports that the model is unavailable. Open
                        chrome://on-device-internals in Chrome to check model eligibility and
                        download errors. Preparing cannot override browser or administrator
                        restrictions.
                      </p>
                    )}
                    {availability === 'unsupported' && (
                      <p className="notice">
                        This browser does not expose the Chrome Prompt API. Update Google Chrome and
                        check its built-in AI support.
                      </p>
                    )}
                    <div className="row">
                      <button
                        className="btn"
                        disabled={testing}
                        onClick={() => void providerTest.refreshAvailability()}
                        aria-label="Check availability"
                        title="Check availability"
                      >
                        <ActionLabel short="Check" full="Check availability" />
                      </button>
                      <button
                        className="btn"
                        disabled={
                          testing ||
                          availability === 'unsupported' ||
                          availability === 'unavailable'
                        }
                        onClick={() => test('prepare')}
                        aria-label="Prepare on-device model"
                        title="Prepare on-device model"
                      >
                        <ActionLabel short="Prepare" full="Prepare on-device model" />
                      </button>
                      <button
                        className="btn"
                        disabled={testing || availability !== 'available'}
                        onClick={() => test('generation')}
                        aria-label="Test generation"
                        title="Test generation"
                      >
                        <ActionLabel short="Test" full="Test generation" />
                      </button>
                    </div>
                    <p className="small muted standard-only">
                      Preparation checks readiness. Test generation verifies that the model returns
                      text. Use the full workspace to keep setup open during a download.
                    </p>
                    <a
                      href="https://developer.chrome.com/docs/ai/prompt-api#hardware-requirements"
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Chrome model requirements"
                      title="Chrome model requirements"
                    >
                      <ActionLabel short="Requirements" full="Chrome model requirements" />
                    </a>
                  </div>
                )
              ) : (
                <>
                  <label className="field">
                    Model name
                    <input
                      placeholder="Model name"
                      value={settings.openaiCompatible.model}
                      onChange={(e) => config({ model: e.target.value })}
                    />
                  </label>
                  <details>
                    <summary aria-label="API connection" title="API connection">
                      <ActionLabel short="Connection" full="API connection" />
                    </summary>
                    <div className="stack settings-disclosure">
                      <div className="row">
                        <label className="field grow">
                          Saved profile
                          <select
                            aria-label="Saved profile"
                            value={settings.activeProfileId}
                            onChange={(e) => {
                              draft.edit({ type: 'select-profile', id: e.target.value });
                              providerTest.clear();
                            }}
                          >
                            {settings.profiles?.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          className="btn"
                          onClick={() => {
                            draft.edit({ type: 'add-profile', id: crypto.randomUUID() });
                            providerTest.clear();
                          }}
                          aria-label="New profile"
                          title="New profile"
                        >
                          <ActionLabel short="New" full="New profile" />
                        </button>
                      </div>
                      <label className="field">
                        Profile name
                        <input
                          value={
                            settings.profiles?.find((p) => p.id === settings.activeProfileId)
                              ?.name || ''
                          }
                          onChange={(e) =>
                            draft.edit({ type: 'profile-name', name: e.target.value })
                          }
                        />
                      </label>
                      <div className="row small">
                        <span className="muted">Fill endpoint:</span>
                        {presets.map((p) => (
                          <button
                            className="btn"
                            key={p.name}
                            onClick={() =>
                              config({
                                baseUrl: p.baseUrl,
                                model: p.model,
                              })
                            }
                          >
                            {p.name}
                          </button>
                        ))}
                      </div>
                      <label className="field">
                        Base URL
                        <input
                          placeholder="https://api.openai.com/v1"
                          value={settings.openaiCompatible.baseUrl}
                          onChange={(e) =>
                            config({
                              baseUrl: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        API key
                        <div className="row">
                          <input
                            className="grow"
                            autoComplete="off"
                            type={visibleKey ? 'text' : 'password'}
                            placeholder="Optional for local models"
                            value={settings.openaiCompatible.apiKey}
                            onChange={(e) => config({ apiKey: e.target.value })}
                          />
                          <button
                            type="button"
                            className="btn"
                            aria-label={visibleKey ? 'Hide API key' : 'Show API key'}
                            onClick={() => setVisibleKey(!visibleKey)}
                          >
                            {visibleKey ? 'Hide' : 'Show'}
                          </button>
                        </div>
                      </label>
                      <p className="small muted standard-only">
                        Each profile keeps its own key. Changing endpoint origin clears the current
                        key.
                      </p>
                    </div>
                  </details>
                  <details>
                    <summary aria-label="Model options and tests" title="Model options and tests">
                      <ActionLabel short="Options" full="Model options and tests" />
                    </summary>
                    <div className="stack settings-disclosure">
                      <label className="field">
                        Temperature: {settings.openaiCompatible.temperature}
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={settings.openaiCompatible.temperature}
                          onChange={(e) => config({ temperature: Number(e.target.value) })}
                        />
                      </label>
                      <div className="row">
                        <button
                          className="btn"
                          disabled={testing}
                          onClick={() => test('endpoint')}
                          aria-label="Test Connection"
                          title="Test Connection"
                        >
                          <ActionLabel short="Check" full="Test Connection" />
                        </button>
                        <button
                          className="btn"
                          disabled={testing}
                          onClick={() => test('generation')}
                          aria-label="Test generation"
                          title="Test generation"
                        >
                          <ActionLabel short="Test" full="Test generation" />
                        </button>
                      </div>
                      <p className="small muted standard-only">
                        Generation sends a short sample prompt using the current form values.
                      </p>
                    </div>
                  </details>
                </>
              )}
            </fieldset>
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
        aria-label={section === 'overview' ? 'Overview' : 'Reading'}
      >
        <h2 className="view-title">{section === 'overview' ? 'Settings' : 'Reading'}</h2>
        <div className="settings-pair">
          <label className="field">
            Default recipe
            <select
              aria-label="Default recipe"
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
          <button className="settings-link" onClick={() => onSectionChange('models')}>
            <span>Models</span>
            <span>
              {configuration.presets.length}
              <span aria-hidden="true"> ›</span>
            </span>
          </button>
          <button className="settings-link" onClick={() => onSectionChange('reading')}>
            <span>Recipes</span>
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
          !actionBuilding &&
          (section === 'preferences' || section === 'connections')
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
        {planBusy && section !== 'models' && (
          <div className="row">
            <span role="status">Account operation in progress.</span>
            <button className="btn" onClick={() => onSectionChange('models')}>
              Models
            </button>
          </div>
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
                disabled={testing || saving || planBusy}
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
              disabled={testing || saving || planBusy || draft.blocked}
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
