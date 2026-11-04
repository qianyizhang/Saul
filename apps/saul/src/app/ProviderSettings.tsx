import { useEffect, useState } from 'react';
import { providerCapabilities } from '../../native/shared-presets-contract.mts';
import type { UserSettings } from '../types';
import type { SettingsEdit } from '../models/settings-draft';
import type { PlanSettingsState } from './usePlanSettings';
import { ChatGPTPlanSettings } from './ChatGPTPlanSettings';
import { SharedCredentialSettings } from './SharedCredentialSettings';
import { officialOpenAI } from '../../native/credentials-contract.mts';

export function ProviderSettings({
  settings,
  edit,
  plan,
  disabled,
  visible,
  credentialLocked,
  changeCredentialOwner,
}: {
  settings: UserSettings;
  edit: (edit: SettingsEdit) => void;
  plan: PlanSettingsState;
  disabled: boolean;
  visible: boolean;
  credentialLocked: boolean;
  changeCredentialOwner: (owner: 'saul' | 'disconnected') => Promise<void>;
}) {
  const providers = settings.providers;
  const [key, setKey] = useState('gpt-plan'),
    [profileId, setProfileId] = useState(''),
    [showKey, setShowKey] = useState(false);
  const provider = providers.find((p) => p.key === key);
  const boundId = settings.providerConnections?.[key];
  const official = settings.profiles?.find(
    (p) =>
      p.id === settings.activeProfileId &&
      p.config.baseUrl.replace(/\/+$/, '') === 'https://api.openai.com/v1',
  );
  const selectedId =
    provider?.kind === 'openai-api'
      ? boundId || official?.id || ''
      : profileId || settings.activeProfileId;
  const profile = settings.profiles?.find((p) => p.id === selectedId);
  useEffect(() => setShowKey(false), [key, selectedId, visible]);
  const selectProfile = (id: string) => {
    setShowKey(false);
    if (provider?.kind === 'openai-api') edit({ type: 'provider-connection', key, profileId: id });
    else setProfileId(id);
  };
  const connection = (patch: Partial<UserSettings['openaiCompatible']>) => {
    if (profile) edit({ type: 'connection', id: profile.id, patch });
  };
  const options = [
    ...providers.map((p) => ({ key: p.key, name: p.name })),
    { key: 'local-api-connections', name: 'API connections' },
  ];
  return (
    <section hidden={!visible} className="settings-section" aria-label="Provider definitions">
      <h2 className="view-title">Providers</h2>
      <SharedCredentialSettings
        owner={settings.sharedCredentials}
        disabled={disabled || credentialLocked}
        visible={visible}
        change={changeCredentialOwner}
      />
      <div className="settings-models">
        <div className="preset-browser">
          <div className="preset-list" aria-label="Providers">
            {options.map((p) => (
              <button
                type="button"
                key={p.key}
                aria-pressed={key === p.key}
                disabled={disabled}
                onClick={() => setKey(p.key)}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
        <div className="stack preset-editor">
          <label className="field compact-preset">
            Provider
            <select
              aria-label="Edit provider"
              disabled={disabled}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            >
              {options.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {provider && (
            <>
              <label className="field">
                Name
                <input
                  aria-label="Provider name"
                  value={provider.name}
                  maxLength={80}
                  disabled={disabled}
                  onChange={(e) => edit({ type: 'provider-name', key, name: e.target.value })}
                />
              </label>
              <dl className="saul-metadata">
                <dt>Key</dt>
                <dd>{provider.key}</dd>
                <dt>Capabilities</dt>
                <dd>
                  {providerCapabilities(provider)
                    .map((c) => c[0]!.toUpperCase() + c.slice(1))
                    .join(' · ')}
                </dd>
              </dl>
            </>
          )}
          {settings.sharedCredentials === 'disconnected' && provider?.kind === 'chatgpt-plan' ? (
            <p className="notice">Connect this app to Saul to manage ChatGPT sign-in.</p>
          ) : provider?.kind === 'chatgpt-plan' ? (
            <ChatGPTPlanSettings
              plan={plan}
              mode="connection"
              visible={visible}
              disabled={disabled}
              test={() => {}}
              shared={settings.sharedCredentials === 'saul'}
            />
          ) : (
            <fieldset className="stack settings-fields" disabled={disabled}>
              <div className="row">
                <label className="field grow">
                  Connection
                  <select
                    aria-label="Saved profile"
                    value={selectedId || ''}
                    onChange={(e) => selectProfile(e.target.value)}
                  >
                    <option value="">Choose a connection</option>
                    {settings.profiles?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="btn"
                  aria-label="New profile"
                  onClick={() => {
                    const id = crypto.randomUUID();
                    edit({ type: 'add-connection', id });
                    selectProfile(id);
                  }}
                >
                  Add
                </button>
              </div>
              {profile ? (
                <>
                  <label className="field">
                    Connection name
                    <input
                      aria-label="Profile name"
                      value={profile.name}
                      maxLength={80}
                      onChange={(e) =>
                        edit({
                          type: 'connection',
                          id: profile.id,
                          patch: {},
                          name: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    Base URL
                    <input
                      value={profile.config.baseUrl}
                      placeholder="https://api.openai.com/v1"
                      onChange={(e) => connection({ baseUrl: e.target.value })}
                    />
                  </label>
                  {settings.sharedCredentials === 'disconnected' &&
                  officialOpenAI(profile.config.baseUrl) ? (
                    <p className="notice">Connect this app to Saul to manage the shared API key.</p>
                  ) : (
                    <label className="field">
                      API key
                      <div className="row">
                        <input
                          className="grow"
                          aria-label="API key"
                          type={showKey ? 'text' : 'password'}
                          placeholder={
                            profile.config.credentialOwner === 'saul'
                              ? 'Replacement shared API key'
                              : 'Optional for local models'
                          }
                          autoComplete="off"
                          value={profile.config.apiKey}
                          onChange={(e) => connection({ apiKey: e.target.value })}
                        />
                        <button
                          className="btn"
                          type="button"
                          aria-label={showKey ? 'Hide API key' : 'Show API key'}
                          onClick={() => setShowKey(!showKey)}
                        >
                          {showKey ? 'Hide' : 'Show'}
                        </button>
                      </div>
                    </label>
                  )}
                  {provider?.kind === 'openai-api' && (
                    <p className="small">
                      Separate API billing
                      {profile.config.baseUrl.replace(/\/+$/, '') === 'https://api.openai.com/v1'
                        ? ''
                        : ' · Speak requires the official OpenAI endpoint'}
                    </p>
                  )}
                  <details>
                    <summary>Endpoint templates</summary>
                    <div className="row settings-disclosure">
                      {[
                        ['OpenAI', 'https://api.openai.com/v1'],
                        ['DeepSeek', 'https://api.deepseek.com/v1'],
                        ['Ollama', 'http://localhost:11434/v1'],
                        ['OpenRouter', 'https://openrouter.ai/api/v1'],
                      ].map(([name, baseUrl]) => (
                        <button className="btn" key={name} onClick={() => connection({ baseUrl })}>
                          {name}
                        </button>
                      ))}
                    </div>
                  </details>
                  <p className="small muted standard-only">
                    Changing endpoint origin clears this connection's key. Save does not send a test
                    request.
                  </p>
                </>
              ) : (
                <p className="notice">Choose or add a connection for this provider.</p>
              )}
            </fieldset>
          )}
        </div>
      </div>
    </section>
  );
}
