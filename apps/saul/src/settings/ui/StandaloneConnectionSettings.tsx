import { useEffect, useState } from 'react';
import { connectionCapabilities } from '../../../shared/protocol/shared-presets-contract.mts';
import type { Configuration } from '../../configuration/definition';
import type { SettingsEdit } from '../draft';
import { officialOpenAI } from '../../../shared/protocol/credentials-contract.mts';
import { ConnectionManagement, type ConnectionManagementAction } from './ConnectionManagement';
import {
  presetCountLabel,
  presetsUsingConnection,
  type ConnectionChange,
} from '../connection-management';

export function StandaloneConnectionSettings({
  settings,
  edit,
  disabled,
  managementDisabled,
  manageConnection,
  onDirty,
  visible,
  integrations,
}: {
  settings: Configuration;
  edit: (edit: SettingsEdit) => void;
  disabled: boolean;
  managementDisabled: boolean;
  manageConnection: (change: ConnectionChange) => Promise<void>;
  onDirty: (dirty: boolean) => void;
  visible: boolean;
  integrations: () => void;
}) {
  const connections = settings.connections;
  const [key, setKey] = useState('gpt-plan'),
    [profileId, setProfileId] = useState(''),
    [showKey, setShowKey] = useState(false);
  const [management, setManagement] = useState<ConnectionManagementAction>();
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
  const editProfile = (patch: Partial<Configuration['openaiCompatible']>) => {
    if (profile) edit({ type: 'connection', id: profile.id, patch });
  };
  const options: { key: string; name: string; presetCount?: number }[] = [
    ...connections.map((p) => ({
      key: p.key,
      name: p.name,
      presetCount: presetsUsingConnection(settings, p.key).length,
    })),
    { key: 'local-api-connections', name: 'API connections' },
  ];
  const selectedPresetCount = options.find((option) => option.key === key)?.presetCount ?? 0;
  if (management && connection)
    return (
      <section hidden={!visible} className="settings-section" aria-label="Connections">
        <h2 className="view-title">Connections</h2>
        <ConnectionManagement
          key={management}
          action={management}
          connection={connection}
          settings={settings}
          disabled={managementDisabled}
          commit={async (change) => {
            await manageConnection(change);
            if (change.action === 'delete') setKey('local-api-connections');
          }}
          close={() => {
            setManagement(undefined);
            onDirty(false);
          }}
          openMove={() => setManagement('move')}
        />
      </section>
    );
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
                {p.presetCount !== undefined && (
                  <span className="small muted"> · {presetCountLabel(p.presetCount)}</span>
                )}
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
                  {p.presetCount !== undefined && ` · ${presetCountLabel(p.presetCount)}`}
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
              <div className="row">
                {selectedPresetCount > 0 && (
                  <button
                    type="button"
                    className="btn"
                    disabled={managementDisabled}
                    onClick={() => {
                      setManagement('move');
                      onDirty(true);
                    }}
                  >
                    Move presets
                  </button>
                )}
                <button
                  type="button"
                  className="btn danger"
                  disabled={managementDisabled}
                  onClick={() => {
                    setManagement('delete');
                    onDirty(true);
                  }}
                >
                  Delete connection
                </button>
              </div>
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
          {connection?.kind === 'chatgpt-plan' ? (
            <div className="stack">
              <p className="notice">ChatGPT uses the signed Saul helper.</p>
              <button type="button" className="btn" onClick={integrations}>
                Open Integrations
              </button>
            </div>
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
