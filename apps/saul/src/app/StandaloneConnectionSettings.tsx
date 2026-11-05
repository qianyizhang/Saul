import { useEffect, useState } from 'react';
import { connectionCapabilities } from '../../native/shared-presets-contract.mts';
import type { UserSettings } from '../types';
import type { SettingsEdit } from '../models/settings-draft';
import type { PlanSettingsState } from './usePlanSettings';
import { ChatGPTPlanSettings } from './ChatGPTPlanSettings';
import { officialOpenAI } from '../../native/credentials-contract.mts';

export function StandaloneConnectionSettings({
  settings,
  edit,
  plan,
  disabled,
  visible,
}: {
  settings: UserSettings;
  edit: (edit: SettingsEdit) => void;
  plan: PlanSettingsState;
  disabled: boolean;
  visible: boolean;
}) {
  const connections = settings.connections;
  const [key, setKey] = useState('gpt-plan'),
    [profileId, setProfileId] = useState(''),
    [showKey, setShowKey] = useState(false);
  const connection = connections.find((p) => p.key === key);
  const boundId = settings.connectionProfiles?.[key];
  const official = settings.profiles?.find(
    (p) =>
      p.id === settings.activeProfileId &&
      p.config.baseUrl.replace(/\/+$/, '') === 'https://api.openai.com/v1',
  );
  const selectedId =
    connection?.kind === 'openai-api'
      ? boundId || official?.id || ''
      : profileId || settings.activeProfileId;
  const profile = settings.profiles?.find((p) => p.id === selectedId);
  useEffect(() => setShowKey(false), [key, selectedId, visible]);
  const selectProfile = (id: string) => {
    setShowKey(false);
    if (connection?.kind === 'openai-api') edit({ type: 'connection-profile', key, profileId: id });
    else setProfileId(id);
  };
  const editProfile = (patch: Partial<UserSettings['openaiCompatible']>) => {
    if (profile) edit({ type: 'connection', id: profile.id, patch });
  };
  const options = [
    ...connections.map((p) => ({ key: p.key, name: p.name })),
    { key: 'local-api-connections', name: 'API connections' },
  ];
  return (
    <section hidden={!visible} className="settings-section" aria-label="Connections">
      <h2 className="view-title">Connections</h2>
      <div className="settings-models">
        <div className="preset-browser">
          <div className="preset-list" aria-label="Connections">
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
            Connection
            <select
              aria-label="Edit connection"
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
          {connection && (
            <>
              <label className="field">
                Name
                <input
                  aria-label="Connection name"
                  value={connection.name}
                  maxLength={80}
                  disabled={disabled}
                  onChange={(e) => edit({ type: 'connection-name', key, name: e.target.value })}
                />
              </label>
              <dl className="saul-metadata">
                <dt>Key</dt>
                <dd>{connection.key}</dd>
                <dt>Capabilities</dt>
                <dd>
                  {connectionCapabilities(connection)
                    .map((c) => c[0]!.toUpperCase() + c.slice(1))
                    .join(' · ')}
                </dd>
              </dl>
            </>
          )}
          {settings.sharedCredentials === 'disconnected' && connection?.kind === 'chatgpt-plan' ? (
            <p className="notice">Connect this app to Saul to manage ChatGPT sign-in.</p>
          ) : connection?.kind === 'chatgpt-plan' ? (
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
                      onChange={(e) => editProfile({ baseUrl: e.target.value })}
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
                          onChange={(e) => editProfile({ apiKey: e.target.value })}
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
                  {connection?.kind === 'openai-api' && (
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
                        <button className="btn" key={name} onClick={() => editProfile({ baseUrl })}>
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
                <p className="notice">Choose or add a connection for this connection.</p>
              )}
            </fieldset>
          )}
        </div>
      </div>
    </section>
  );
}
