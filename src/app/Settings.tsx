import { useEffect, useRef, useState } from 'react';
import { getSettings, saveSettings, DEFAULT_SETTINGS } from '../storage/settings';
import { DEFAULT_SYSTEM_PROMPT } from '../models/prompts';
import { streamOpenAICompatible } from '../models/openai-compatible';
import { chromeAiAvailability, prepareChromeAi } from '../models/chrome-ai';
import type { ProviderProfile, UserSettings } from '../types';

const presets = [
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: '' },
];
function origin(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}
export function Settings({
  onSaved,
  onDirty,
}: {
  onSaved?: () => void;
  onDirty?: (dirty: boolean) => void;
}) {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [testing, setTesting] = useState(false);
  const [visibleKey, setVisibleKey] = useState(false);
  const [availability, setAvailability] = useState('Checking…');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    getSettings()
      .then((s) => {
        const id = s.activeProfileId || 'default';
        setSettings({
          ...s,
          activeProfileId: id,
          profiles: s.profiles?.length
            ? s.profiles
            : [{ id, name: 'Default', config: s.openaiCompatible }],
        });
        setLoaded(true);
      })
      .catch((err) => setError(err.message));
    chromeAiAvailability().then(setAvailability);
    return () => controller.current?.abort();
  }, []);
  useEffect(() => {
    onDirty?.(dirty);
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    if (dirty) window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, onDirty]);
  function update(patch: Partial<UserSettings>) {
    setSettings((s) => ({ ...s, ...patch }));
    setDirty(true);
    setSaved(false);
    setNotice('');
    setError('');
  }
  function config(patch: Partial<UserSettings['openaiCompatible']>) {
    update({ openaiCompatible: { ...settings.openaiCompatible, ...patch } });
  }
  function profilesWithCurrent(): ProviderProfile[] {
    return (settings.profiles || []).map((p) =>
      p.id === settings.activeProfileId ? { ...p, config: settings.openaiCompatible } : p,
    );
  }
  function switchProfile(id: string) {
    const profiles = profilesWithCurrent();
    const p = profiles.find((p) => p.id === id);
    if (p) update({ profiles, activeProfileId: id, openaiCompatible: p.config });
  }
  function validate() {
    if (settings.activeProvider === 'chrome-ai') return;
    let url: URL;
    try {
      url = new URL(settings.openaiCompatible.baseUrl);
    } catch {
      throw new Error('Enter a valid model endpoint URL.');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        'Use an HTTP(S) endpoint without credentials, query parameters, or a fragment.',
      );
    if (!settings.openaiCompatible.model.trim())
      throw new Error('Enter a model name available from this provider.');
  }
  async function save() {
    setError('');
    try {
      validate();
      const next = { ...settings, profiles: profilesWithCurrent() };
      await saveSettings(next);
      setSettings(next);
      setDirty(false);
      setSaved(true);
      onSaved?.();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function test(mode: 'endpoint' | 'generation') {
    setError('');
    setNotice('');
    setTesting(true);
    const ac = new AbortController();
    controller.current = ac;
    // Model preparation can include a large download; the user can stop it.
    const timeout =
      settings.activeProvider === 'chrome-ai' ? undefined : setTimeout(() => ac.abort(), 20000);
    try {
      validate();
      if (settings.activeProvider === 'chrome-ai') {
        await prepareChromeAi(ac.signal, (progress) =>
          setNotice(`Downloading model: ${Math.round(progress * 100)}%`),
        );
        setAvailability(await chromeAiAvailability());
        setNotice('On-device model is ready.');
      } else if (mode === 'endpoint') {
        const base = settings.openaiCompatible.baseUrl
          .replace(/\/+$/, '')
          .replace(/\/chat\/completions$/, '');
        const res = await fetch(`${base}/models`, {
          signal: ac.signal,
          headers: settings.openaiCompatible.apiKey
            ? { Authorization: `Bearer ${settings.openaiCompatible.apiKey}` }
            : {},
        });
        if (!res.ok)
          throw new Error(
            `Endpoint returned ${res.status}. Generation may still work if this server does not expose a model list.`,
          );
        setNotice('Endpoint reachable. Use Test generation to check the selected model.');
      } else {
        let answer = '';
        for await (const part of streamOpenAICompatible(
          { ...settings.openaiCompatible, maxTokens: 32 },
          'Reply briefly.',
          'Say hello.',
          ac.signal,
        ))
          answer += part;
        if (!answer.trim())
          throw new Error('The model returned no text. Check the model and endpoint.');
        setNotice(`Generation succeeded: ${answer.slice(0, 120)}`);
      }
    } catch (err) {
      setError(
        ac.signal.aborted
          ? 'Test stopped or timed out. Try again when the provider is ready.'
          : (err as Error).message,
      );
    } finally {
      clearTimeout(timeout);
      controller.current = null;
      setTesting(false);
    }
  }
  if (!loaded)
    return error ? (
      <p role="alert" className="notice error">
        {error}
      </p>
    ) : (
      <p role="status">Loading settings…</p>
    );
  return (
    <div className="stack settings-layout">
      <div>
        <h2 style={{ margin: 0, fontSize: 20 }}>Settings</h2>
        <p className="small muted">Choose how Saul explains and what context it uses.</p>
      </div>
      <section className="panel settings-section">
        <h3>Model</h3>
        <fieldset className="settings-fields" disabled={testing}>
          <label className="field">
            Provider
            <select
              aria-label="Provider"
              value={settings.activeProvider}
              onChange={(e) =>
                update({ activeProvider: e.target.value as UserSettings['activeProvider'] })
              }
            >
              <option value="openai-compatible">OpenAI compatible</option>
              <option value="chrome-ai">Chrome on-device AI</option>
            </select>
          </label>
          {settings.activeProvider === 'chrome-ai' ? (
            <div className="stack">
              <p className="muted">
                Availability: {availability}. On-device setup may require a model download.
              </p>
              <button className="btn" disabled={testing} onClick={() => test('generation')}>
                Prepare on-device model
              </button>
            </div>
          ) : (
            <>
              <div className="row">
                <label className="field grow">
                  Saved profile
                  <select
                    aria-label="Saved profile"
                    value={settings.activeProfileId}
                    onChange={(e) => switchProfile(e.target.value)}
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
                    const id = crypto.randomUUID();
                    const profile = {
                      id,
                      name: `Profile ${(settings.profiles?.length || 0) + 1}`,
                      config: { ...DEFAULT_SETTINGS.openaiCompatible, apiKey: '' },
                    };
                    update({
                      profiles: [...profilesWithCurrent(), profile],
                      activeProfileId: id,
                      openaiCompatible: profile.config,
                    });
                  }}
                >
                  New profile
                </button>
              </div>
              <label className="field">
                Profile name
                <input
                  value={
                    settings.profiles?.find((p) => p.id === settings.activeProfileId)?.name || ''
                  }
                  onChange={(e) =>
                    update({
                      profiles: settings.profiles?.map((p) =>
                        p.id === settings.activeProfileId ? { ...p, name: e.target.value } : p,
                      ),
                    })
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
                        ...(origin(p.baseUrl) !== origin(settings.openaiCompatible.baseUrl)
                          ? { apiKey: '' }
                          : {}),
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
                      ...(origin(e.target.value) !== origin(settings.openaiCompatible.baseUrl)
                        ? { apiKey: '' }
                        : {}),
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
              <label className="field">
                Model name
                <input
                  placeholder="Model name"
                  value={settings.openaiCompatible.model}
                  onChange={(e) => config({ model: e.target.value })}
                />
              </label>
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
            </>
          )}
        </fieldset>
        {testing && (
          <div className="row">
            <span role="status" className="small muted">
              {settings.activeProvider === 'chrome-ai'
                ? 'Preparing on-device model…'
                : 'Testing provider…'}
            </span>
            <button className="btn" onClick={() => controller.current?.abort()}>
              Stop test
            </button>
          </div>
        )}
      </section>
      <section className="panel settings-section">
        <h3>Reading preferences</h3>
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
                update({ contextPolicy: { ...settings.contextPolicy, [key]: e.target.checked } })
              }
            />
          </label>
        ))}
        <p className="small muted">
          Selected text and enabled context are sent to your chosen model when you ask for an
          explanation.
        </p>
      </section>
      <details className="panel">
        <summary>Advanced prompt</summary>
        <div className="settings-section" style={{ marginTop: 12 }}>
          <label className="field">
            System prompt
            <textarea
              rows={8}
              value={settings.customPromptTemplate || ''}
              onChange={(e) => update({ customPromptTemplate: e.target.value })}
            />
          </label>
          <p className="small muted">
            Keep the &lt;term note="…"&gt; instructions for inline concept notes.
          </p>
          <button
            className="btn"
            onClick={() => update({ customPromptTemplate: DEFAULT_SYSTEM_PROMPT })}
          >
            Reset prompt
          </button>
        </div>
      </details>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <div className="row between">
        <span className="small muted" role="status">
          {dirty
            ? 'Unsaved changes'
            : saved
              ? 'Saved on this device'
              : 'Settings stored on this device'}
        </span>
        <button className="btn primary" disabled={testing} onClick={save}>
          {saved ? 'Saved!' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
