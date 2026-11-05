import { useEffect, useRef, useState } from 'react';
import {
  connectionCapabilities,
  validConnectionEndpoint,
  type ConnectionDefinition,
} from '../../native/shared-presets-contract.mts';
import {
  validConnectionStatus,
  type ConnectionStatus,
} from '../../native/connections-contract.mts';
import { credentialCall } from '../native/credentials';
import type { ModelPreset, UserSettings } from '../types';
import { useConnectionCatalog } from './useConnectionCatalog';

type Account = { id: string; label: string; signedIn: boolean; planEnabled: boolean };
const message = (cause: unknown) => (cause instanceof Error ? cause.message : 'Connection failed.');

function ConnectionRow({
  connection,
  enabled,
  locked,
  setup,
  remove,
  integrations,
}: {
  connection: ConnectionDefinition;
  enabled: boolean;
  locked: boolean;
  setup: () => void;
  remove: () => void;
  integrations: () => void;
}) {
  const [status, setStatus] = useState<ConnectionStatus>();
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [revision, setRevision] = useState(0);
  const ready = enabled && (connection.kind !== 'chatgpt-plan' || !!connection.accountId);
  const { catalog, loading, refresh } = useConnectionCatalog(connection.key, ready);
  useEffect(() => {
    if (!ready) return;
    const ac = new AbortController();
    setChecking(true);
    void credentialCall(
      { action: 'connection-status', connectionKey: connection.key },
      AbortSignal.any([ac.signal, AbortSignal.timeout(20_000)]),
    )
      .then((reply) => {
        if (!validConnectionStatus(reply.connection)) throw new Error('Invalid connection status.');
        if (!ac.signal.aborted) {
          setStatus(reply.connection);
          setError('');
        }
      })
      .catch((cause) => {
        if (!ac.signal.aborted) setError(message(cause));
      })
      .finally(() => {
        if (!ac.signal.aborted) setChecking(false);
      });
    return () => ac.abort();
  }, [ready, connection.key, connection.accountId, revision]);
  const failure = error || catalog?.error;
  const identity =
    connection.kind === 'chatgpt-plan'
      ? status?.identity || (connection.accountId ? 'Loading account…' : 'No account selected')
      : `${connection.baseUrl ?? 'https://api.openai.com/v1'}${status?.keySuffix ? ` · sk-***${status.keySuffix}` : ''}`;
  return (
    <article className="connection-row" aria-label={connection.name}>
      <div className="row between">
        <strong>{connection.name}</strong>
        <details className="connection-more">
          <summary aria-label={`More for ${connection.name}`}>···</summary>
          <div className="stack">
            <button type="button" className="btn" disabled={!enabled || locked} onClick={setup}>
              {connection.kind === 'chatgpt-plan' ? 'Sign in again' : 'Replace key'}
            </button>
            {connection.kind === 'chatgpt-plan' && (
              <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">
                Usage
              </a>
            )}
            <button
              type="button"
              className="btn danger"
              disabled={!enabled || locked}
              onClick={remove}
            >
              {connection.kind === 'chatgpt-plan' ? 'Sign out' : 'Remove key'}
            </button>
          </div>
        </details>
      </div>
      <p className="connection-capabilities">
        {connectionCapabilities(connection).map((capability) => (
          <code key={capability}>{capability[0]!.toUpperCase() + capability.slice(1)}</code>
        ))}
      </p>
      <p className="connection-identity">{identity}</p>
      <div className="row between">
        <span role="status">
          {!enabled
            ? 'Helper disconnected'
            : checking || loading
              ? 'Checking…'
              : failure
                ? 'Needs attention'
                : status?.connected
                  ? '✓ Connected'
                  : 'Not set up'}
        </span>
        {!enabled ? (
          <button type="button" className="btn" onClick={integrations}>
            Open Integrations
          </button>
        ) : !ready || status?.connected === false ? (
          <button type="button" className="btn" disabled={locked} onClick={setup}>
            Set up
          </button>
        ) : (
          <button
            type="button"
            className="btn"
            disabled={checking || loading}
            onClick={() => {
              setRevision((v) => v + 1);
              refresh();
            }}
          >
            Check
          </button>
        )}
      </div>
      {failure && (
        <p className="notice error" role="alert">
          {failure}
        </p>
      )}
    </article>
  );
}

export function ConnectionSettings({
  settings,
  visible,
  disabled,
  dirty,
  commit,
  integrations,
  onDirty,
}: {
  settings: UserSettings;
  visible: boolean;
  disabled: boolean;
  dirty: boolean;
  commit: (connections: ConnectionDefinition[]) => Promise<void>;
  integrations: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [target, setTarget] = useState<ConnectionDefinition>();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<'plan' | 'api' | 'custom'>('plan');
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('https://api.openai.com/v1');
  const [key, setKey] = useState('');
  const [accountId, setAccountId] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [newId, setNewId] = useState('');
  const loginController = useRef<AbortController | null>(null);
  useEffect(() => () => loginController.current?.abort(), []);
  const enabled = settings.sharedCredentials === 'saul';
  const loadAccounts = async () => {
    const reply = await credentialCall({ action: 'accounts' }, AbortSignal.timeout(20_000));
    if (!Array.isArray(reply.accounts)) throw new Error('Invalid account list.');
    // Credential transport validates every account field before returning it.
    setAccounts(reply.accounts as Account[]);
  };
  const open = (connection?: ConnectionDefinition) => {
    setTarget(connection);
    setAdding(true);
    onDirty(true);
    setError('');
    setKey('');
    setName(connection?.name ?? '');
    setAccountId(connection?.accountId ?? '');
    setEndpoint(connection?.baseUrl ?? 'https://api.openai.com/v1');
    setKind(
      connection?.kind === 'openai-api'
        ? connection.baseUrl && connection.baseUrl !== 'https://api.openai.com/v1'
          ? 'custom'
          : 'api'
        : 'plan',
    );
    setNewId(`connection-${crypto.randomUUID()}`);
    if (!connection || connection.kind === 'chatgpt-plan')
      void loadAccounts().catch((cause) => setError(message(cause)));
  };
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const id = target?.key ?? newId;
      let definition: ConnectionDefinition;
      if (kind === 'plan') {
        const account = accounts.find((a) => a.id === accountId && a.signedIn && a.planEnabled);
        if (!account) throw new Error('Sign in and allow plan use before saving this connection.');
        if (target?.accountId && target.accountId !== account.id)
          throw new Error('This connection is bound to another account.');
        if (settings.connections.some((p) => p.key !== id && p.accountId === account.id))
          throw new Error('This account already has a connection.');
        definition = {
          key: id,
          name: target?.name ?? (name.trim() || account.label.slice(0, 80)),
          kind: 'chatgpt-plan',
          accountId: account.id,
        };
      } else {
        const url =
          kind === 'api' ? 'https://api.openai.com/v1' : endpoint.trim().replace(/\/+$/, '');
        if (!validConnectionEndpoint(url))
          throw new Error(
            'Use HTTPS, or HTTP on localhost, without credentials or query parameters.',
          );
        definition = {
          key: id,
          name: target?.name ?? name.trim(),
          kind: 'openai-api',
          baseUrl: url,
        };
        if (!definition.name) throw new Error('Name this connection.');
        await credentialCall(
          { action: 'connection-key-save', connectionKey: id, endpoint: url, key },
          AbortSignal.timeout(20_000),
        );
      }
      await commit(
        target
          ? settings.connections.map((p) => (p.key === id ? definition : p))
          : [...settings.connections, definition],
      );
      setAdding(false);
      onDirty(false);
      setKey('');
      setRevision((v) => v + 1);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  const signIn = async () => {
    setBusy(true);
    setError('');
    const ac = new AbortController();
    loginController.current = ac;
    try {
      const result = await credentialCall(
        {
          action: 'login',
          ...(target?.accountId ? { accountId: target.accountId } : {}),
          consent: true,
        },
        AbortSignal.any([ac.signal, AbortSignal.timeout(320_000)]),
      );
      await loadAccounts();
      const account = result.account as Account | undefined;
      if (account) setAccountId(account.id);
    } catch (cause) {
      setError(message(cause));
    } finally {
      loginController.current = null;
      setBusy(false);
    }
  };
  const remove = async (connection: ConnectionDefinition) => {
    const action =
      connection.kind === 'chatgpt-plan' ? 'Sign out of this account' : 'Remove this API key';
    if (
      !window.confirm(
        `${action} in both Saul and EZ? Presets keep this connection and will show that setup is required.`,
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      if (connection.kind === 'chatgpt-plan') {
        if (!connection.accountId) throw new Error('This connection has no account.');
        await credentialCall({ action: 'logout', accountId: connection.accountId });
      } else
        await credentialCall({
          action: 'connection-key-remove',
          connectionKey: connection.key,
          endpoint: connection.baseUrl ?? 'https://api.openai.com/v1',
        });
      setRevision((v) => v + 1);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section hidden={!visible} className="settings-section" aria-label="Connections">
      <div className="row between">
        <h2 className="view-title">Connections</h2>
        <button
          type="button"
          className="btn"
          disabled={disabled || dirty || busy || !enabled || settings.connections.length >= 32}
          onClick={() => open()}
        >
          ＋ Add
        </button>
      </div>
      {dirty && (
        <p className="notice">Save the current settings draft before changing connections.</p>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {loginController.current && (
        <button type="button" className="btn" onClick={() => loginController.current?.abort()}>
          Cancel sign-in
        </button>
      )}
      {adding ? (
        <fieldset className="stack settings-fields" disabled={busy || disabled}>
          <h3>{target ? `Set up ${target.name}` : 'Add connection'}</h3>
          {!target && (
            <label className="field">
              Type
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as typeof kind);
                  setError('');
                }}
              >
                <option value="plan">ChatGPT plan</option>
                <option value="api">OpenAI API</option>
                <option value="custom">Custom endpoint</option>
              </select>
            </label>
          )}
          {!target && (
            <label className="field">
              Name
              <input maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          )}
          {kind === 'plan' ? (
            <>
              <label className="field">
                Account
                <select
                  value={accountId}
                  disabled={!!target?.accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  <option value="">Choose an account</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                      {!a.planEnabled ? ' · plan permission required' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn" onClick={() => void signIn()}>
                Sign in and allow plan use
              </button>
            </>
          ) : (
            <>
              {kind === 'custom' && (
                <label className="field">
                  Endpoint
                  <input
                    value={endpoint}
                    disabled={!!target?.baseUrl}
                    onChange={(e) => setEndpoint(e.target.value)}
                    placeholder="https://example.com/v1"
                  />
                </label>
              )}
              <label className="field">
                API key
                <input
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={kind === 'custom' ? 'Optional for localhost' : 'API key'}
                />
              </label>
              <p className="small">
                {kind === 'api'
                  ? 'OpenAI API billing is separate from your ChatGPT plan.'
                  : 'Uses this endpoint’s billing. Keys stay bound to this endpoint.'}
              </p>
            </>
          )}
          <div className="row">
            <button type="button" className="btn primary" onClick={() => void save()}>
              Save
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setAdding(false);
                onDirty(false);
                setKey('');
                setError('');
              }}
            >
              Cancel
            </button>
          </div>
        </fieldset>
      ) : (
        visible &&
        settings.connections.map((connection) => (
          <ConnectionRow
            key={`${connection.key}:${revision}`}
            connection={connection}
            enabled={enabled}
            locked={busy || dirty || disabled}
            setup={() => {
              if (!dirty && !disabled) open(connection);
            }}
            remove={() => void remove(connection)}
            integrations={integrations}
          />
        ))
      )}
    </section>
  );
}

/** Show confirmed removals as soon as Settings opens, including unselected presets. */
export function ConnectionPresetWarnings({
  connection,
  presets,
  omitPresetId,
  edit,
}: {
  omitPresetId?: string;
  connection: ConnectionDefinition;
  presets: ModelPreset[];
  edit: (id: string) => void;
}) {
  const { catalog } = useConnectionCatalog(connection.key);
  if (!catalog?.fetchedAt) return null;
  const affected = presets.filter(
    (p) =>
      p.id !== omitPresetId &&
      p.connectionKey === connection.key &&
      p.model &&
      !catalog.models.some((m) => m.id === p.model),
  );
  if (!affected.length) return null;
  return (
    <div className="notice error" role="alert">
      {affected.map((p) => (
        <div className="row between" key={p.id}>
          <span>
            “{p.name}”: model “{p.model}” is no longer available.
          </span>
          <button type="button" className="btn" onClick={() => edit(p.id)}>
            Edit preset
          </button>
        </div>
      ))}
    </div>
  );
}
