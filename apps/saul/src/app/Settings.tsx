import { ChatGPTPlanSettings } from './ChatGPTPlanSettings';
import { useEffect, useState } from 'react';
import type { UserSettings } from '../types';
import { useSettingsDraft } from './useSettingsDraft';
import { useProviderTest } from './useProviderTest';
import { CHROME_AI_ENABLED, CHROME_AI_DISABLED_MESSAGE } from '../models/chrome-ai';
import { configurationFor } from '../models/configuration';
import { RecipeSettings } from './RecipeSettings';

const presets = [
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: '' },
];
export function Settings({ onDirty }: { onDirty?: (dirty: boolean) => void }) {
  const draft = useSettingsDraft(onDirty);
  const { settings, loaded, dirty, saved, saving, save } = draft;
  const providerTest = useProviderTest(settings.activeProvider);
  const { testing, notice, availability } = providerTest;
  const error = draft.error || providerTest.error;
  const [visibleKey, setVisibleKey] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
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
            disabled={draft.resettingInvalidSettings || draft.blocked}
            onClick={draft.resetInvalidSettings}
          >
            {draft.resettingInvalidSettings
              ? 'Backing up and resetting…'
              : 'Back up and reset settings'}
          </button>
        )}
        <button className="btn" disabled={saving} onClick={draft.reload}>
          Reload saved settings
        </button>
      </div>
    ) : (
      <p role="status">Loading settings…</p>
    );
  return (
    <fieldset className="stack settings-layout settings-fields" disabled={saving}>
      <section className="panel settings-section" aria-label="AI">
        <h3>AI</h3>
        {configuration.presets.length > 1 && (
          <p className="small muted">Editing model preset: {selectedPreset?.name}</p>
        )}
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
                <p className="muted">
                  Chrome's built-in Gemini Nano runs locally after a separate model download.
                </p>
                <p className="small" role="status">
                  Availability: {availability}.
                </p>
                {availability === 'unavailable' && (
                  <p className="notice">
                    Chrome reports that the model is unavailable. Open chrome://on-device-internals
                    in Chrome to check model eligibility and download errors. Preparing cannot
                    override browser or administrator restrictions.
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
                  >
                    Check availability
                  </button>
                  <button
                    className="btn"
                    disabled={
                      testing || availability === 'unsupported' || availability === 'unavailable'
                    }
                    onClick={() => test('prepare')}
                  >
                    Prepare on-device model
                  </button>
                  <button
                    className="btn"
                    disabled={testing || availability !== 'available'}
                    onClick={() => test('generation')}
                  >
                    Test generation
                  </button>
                </div>
                <p className="small muted">
                  Preparation checks readiness. Test generation verifies that the model returns
                  text. Use the full workspace to keep setup open during a download.
                </p>
                <a
                  href="https://developer.chrome.com/docs/ai/prompt-api#hardware-requirements"
                  target="_blank"
                  rel="noreferrer"
                >
                  Chrome model requirements
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
                <summary>API connection</summary>
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
                    >
                      New profile
                    </button>
                  </div>
                  <label className="field">
                    Profile name
                    <input
                      value={
                        settings.profiles?.find((p) => p.id === settings.activeProfileId)?.name ||
                        ''
                      }
                      onChange={(e) => draft.edit({ type: 'profile-name', name: e.target.value })}
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
                  <p className="small muted">
                    Each profile keeps its own key. Changing endpoint origin clears the current key.
                  </p>
                </div>
              </details>
              <details>
                <summary>Model options and tests</summary>
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
                    <button className="btn" disabled={testing} onClick={() => test('endpoint')}>
                      Test Connection
                    </button>
                    <button className="btn" disabled={testing} onClick={() => test('generation')}>
                      Test generation
                    </button>
                  </div>
                  <p className="small muted">
                    Generation sends a short sample prompt using the current form values.
                  </p>
                </div>
              </details>
            </>
          )}
        </fieldset>
        {testing && (
          <div className="row">
            <span role="status" className="small muted">
              {providerTest.preparing ? 'Preparing on-device model…' : 'Testing provider…'}
            </span>
            <button className="btn" onClick={providerTest.stop}>
              Stop test
            </button>
          </div>
        )}
        <details>
          <summary>Manage model presets</summary>
          <fieldset className="settings-fields settings-disclosure" disabled={testing || planBusy}>
            <p className="small muted">Save model choices for different recipes.</p>
            <label className="field">
              Preset
              <select
                aria-label="Preset"
                disabled={planBusy}
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
            {selectedPreset && (
              <label className="field">
                Preset name
                <input
                  maxLength={80}
                  value={selectedPreset.name}
                  onChange={(event) =>
                    draft.edit({ type: 'preset-name', name: event.target.value })
                  }
                />
              </label>
            )}
            <button
              className="btn"
              disabled={testing || planBusy || configuration.presets.length >= 32}
              onClick={() => draft.edit({ type: 'add-preset', id: crypto.randomUUID() })}
            >
              Add preset
            </button>
            <button
              className="btn danger"
              disabled={testing || planBusy || configuration.presets.length <= 1}
              onClick={() => draft.edit({ type: 'remove-preset' })}
            >
              Remove preset
            </button>
          </fieldset>
        </details>
      </section>
      <section className="panel settings-section">
        <h3>Reading</h3>
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
        <details>
          <summary>Include with selected text</summary>
          <div className="stack settings-disclosure">
            <p className="small muted">
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
      </section>
      <details className="panel shortcuts">
        <summary>Shortcuts</summary>
        <dl>
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
      </details>
      <div className="settings-save">
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
            {dirty ? 'Unsaved changes' : saved ? 'Saved' : 'AI and reading settings'}
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
              >
                Reload saved settings
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
