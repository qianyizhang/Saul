import { useCallback, useEffect, useRef, useState } from 'react';
import {
  connectionCapabilities,
  validConnectionEndpoint,
  type ConnectionDefinition,
} from '../../../shared/protocol/shared-presets-contract.mts';
import {
  validConnectionStatus,
  type ConnectionStatus,
} from '../../../shared/protocol/connections-contract.mts';
import { credentialCall } from '../../native/credentials';
import { planCall } from '../../providers/chatgpt-plan';
import type { ModelPreset } from '../../../shared/model/presets.ts';
import type { Configuration } from '../../configuration/definition';
import type { PlanAccount, PlanResults } from '../../../shared/protocol/credential-plan.mts';
import { useConnectionCatalog } from './useConnectionCatalog';

type Logout = PlanResults['logout'];
const message = (cause: unknown) => (cause instanceof Error ? cause.message : 'Connection failed.');

function ConnectionRow({
  connection,
  enabled,
  locked,
  dirty,
  logout,
  reveal,
  onRevealed,
  setup,
  remove,
  integrations,
}: {
  connection: ConnectionDefinition;
  enabled: boolean;
  locked: boolean;
  dirty: boolean;
  logout?: Logout;
  reveal: boolean;
  onRevealed: () => void;
  setup: () => void;
  remove: () => void;
  integrations: () => void;
}) {
  const [status, setStatus] = useState<ConnectionStatus>();
  const [error, setError] = useState('');
  const [readingStatus, setReadingStatus] = useState(false);
  const statusRequest = useRef<AbortController | null>(null);
  const row = useRef<HTMLElement>(null);
  const ready = enabled && (connection.kind !== 'chatgpt-plan' || !!connection.accountId);
  const signedOut = ready && !!logout && status?.signedIn !== true;
  const { catalog, loading, checking, check } = useConnectionCatalog(
    connection.key,
    ready && !signedOut,
  );
  useEffect(() => {
    if (reveal) {
      row.current?.focus();
      onRevealed();
    }
  }, [reveal, onRevealed]);
  const readStatus = useCallback(async () => {
    statusRequest.current?.abort();
    const ac = new AbortController();
    statusRequest.current = ac;
    setReadingStatus(true);
    try {
      const reply = await credentialCall(
        { action: 'connection-status', connectionKey: connection.key },
        AbortSignal.any([ac.signal, AbortSignal.timeout(20_000)]),
      );
      if (!validConnectionStatus(reply.connection)) throw new Error('Invalid connection status.');
      if (!ac.signal.aborted) {
        setStatus(reply.connection);
        setError('');
      }
    } catch (cause) {
      if (!ac.signal.aborted) setError(message(cause));
    } finally {
      if (!ac.signal.aborted) setReadingStatus(false);
    }
  }, [connection.key]);
  useEffect(() => {
    if (ready) void readStatus();
    return () => statusRequest.current?.abort();
  }, [ready, readStatus]);
  const failure = error || catalog?.error;
  const identity =
    connection.kind === 'chatgpt-plan'
      ? (status?.identity ?? logout?.account.label) ||
        (connection.accountId ? 'Loading account…' : 'No account selected')
      : `${connection.baseUrl ?? 'https://api.openai.com/v1'}${status?.keySuffix ? ` · sk-***${status.keySuffix}` : ''}`;
  return (
    <article ref={row} tabIndex={-1} className="connection-row" aria-label={connection.name}>
      <div className="row between">
        <strong>{connection.name}</strong>
        <details className="connection-more">
          <summary aria-label={`More for ${connection.name}`}>···</summary>
          <div className="stack">
            <button
              type="button"
              className="btn"
              disabled={!enabled || locked || dirty}
              onClick={setup}
            >
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
              disabled={!enabled || locked || dirty}
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
      {identity !== connection.name && <p className="connection-identity">{identity}</p>}
      <div className="row between">
        <span role="status">
          {!enabled
            ? 'Helper disconnected'
            : signedOut || status?.signedIn === false
              ? 'Signed out'
              : readingStatus || loading
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
        ) : !ready || signedOut || status?.connected === false ? (
          <button type="button" className="btn" disabled={locked || dirty} onClick={setup}>
            Set up
          </button>
        ) : (
          <button
            type="button"
            className="btn"
            disabled={locked || checking}
            onClick={() => {
              void readStatus();
              check();
            }}
          >
            Check
          </button>
        )}
      </div>
      {signedOut && logout?.warning && (
        <p className="notice" role="status">
          {logout.warning}
        </p>
      )}
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
  focusConnection,
  onConnectionFocused,
}: {
  settings: Configuration;
  visible: boolean;
  disabled: boolean;
  dirty: boolean;
  commit: (connections: ConnectionDefinition[]) => Promise<void>;
  integrations: () => void;
  onDirty: (dirty: boolean) => void;
  focusConnection?: string;
  onConnectionFocused: () => void;
}) {
  const [target, setTarget] = useState<ConnectionDefinition>();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<'plan' | 'api' | 'custom'>('plan');
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('https://api.openai.com/v1');
  const [key, setKey] = useState('');
  const [accountId, setAccountId] = useState('');
  const [registration, setRegistration] = useState<{
    name: string;
    accountId?: string;
    confirmed?: boolean;
  }>();
  const [accounts, setAccounts] = useState<PlanAccount[]>([]);
  const [logouts, setLogouts] = useState<ReadonlyMap<string, Logout>>(() => new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [newId, setNewId] = useState('');
  const loginController = useRef<AbortController | null>(null);
  const suggestedNameInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => loginController.current?.abort(), []);
  const enabled = settings.sharedCredentials === 'saul';
  const selectedAccount = accounts.find((account) => account.id === accountId);
  const planReady = !!(selectedAccount?.signedIn && selectedAccount.planEnabled);
  const needsPlanPermission = !!(selectedAccount?.signedIn && !selectedAccount.planEnabled);
  const preparingRegistration = !!registration && !registration.accountId;
  const finishingRegistration = !!registration?.accountId;
  const boundPlan = kind === 'plan' && !!target?.accountId;
  useEffect(() => {
    if (preparingRegistration) suggestedNameInput.current?.focus();
  }, [preparingRegistration]);
  const loadAccounts = async () => {
    const reply = await planCall({ action: 'accounts' }, AbortSignal.timeout(20_000));
    setAccounts(reply.accounts);
  };
  const open = (connection?: ConnectionDefinition) => {
    setTarget(connection);
    setAdding(true);
    onDirty(true);
    setError('');
    setKey('');
    setName(connection?.name ?? '');
    setAccountId(connection?.accountId ?? '');
    setRegistration(undefined);
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
          name: target?.name ?? (name.trim() || 'ChatGPT plan'),
          kind: 'chatgpt-plan',
          accountId: account.id,
        };
        if (registration?.confirmed && registration.accountId === account.id) {
          await credentialCall(
            {
              action: 'confirm-app-name',
              accountId: account.id,
              suggestedAppName: registration.name,
            },
            AbortSignal.timeout(20_000),
          );
        }
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
  const signIn = async (newAppName?: string) => {
    setBusy(true);
    setError('');
    const ac = new AbortController();
    loginController.current = ac;
    try {
      const selected = target?.accountId ?? accountId;
      if (!newAppName && !selected) throw new Error('Choose an account to sign in again.');
      const result = await planCall(
        {
          action: 'login',
          ...(newAppName ? { suggestedAppName: newAppName } : { accountId: selected }),
          consent: !newAppName && needsPlanPermission,
        },
        AbortSignal.any([ac.signal, AbortSignal.timeout(320_000)]),
      );
      if (result.account.signedIn)
        setLogouts((previous) => {
          const next = new Map(previous);
          next.delete(result.account.id);
          return next;
        });
      await loadAccounts();
      if (newAppName) setRegistration({ name: newAppName, accountId: result.account.id });
      setAccountId(result.account.id);
      if (!result.account.planEnabled)
        setError('ChatGPT plan use is still disabled for this account.');
      if (boundPlan && result.account.planEnabled) {
        setAdding(false);
        onDirty(false);
        setRevision((v) => v + 1);
      }
    } catch (cause) {
      if (newAppName) setRegistration(undefined);
      setError(message(cause));
      if (!ac.signal.aborted) await loadAccounts().catch(() => {});
    } finally {
      loginController.current = null;
      setBusy(false);
    }
  };
  const copyAndSignIn = async (appName: string) => {
    setBusy(true);
    try {
      await navigator.clipboard.writeText(appName);
    } catch {
      setError('Could not copy the app name. Try again.');
      setBusy(false);
      return;
    }
    await signIn(appName);
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
        const result = await planCall({ action: 'logout', accountId: connection.accountId });
        if (result.account.id !== connection.accountId || result.account.signedIn)
          throw new Error('The helper did not confirm local sign-out.');
        setLogouts((previous) => new Map(previous).set(result.account.id, result));
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
        {!adding && (
          <button
            type="button"
            className="btn"
            disabled={disabled || dirty || busy || !enabled || settings.connections.length >= 32}
            onClick={() => open()}
          >
            ＋ Add
          </button>
        )}
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
        <div className="row">
          <span role="status">Waiting for ChatGPT…</span>
          <button type="button" className="btn" onClick={() => loginController.current?.abort()}>
            Cancel sign-in
          </button>
        </div>
      )}
      {adding ? (
        <fieldset className="stack settings-fields" disabled={busy || disabled}>
          <h3>
            {preparingRegistration
              ? 'Register with ChatGPT'
              : finishingRegistration
                ? 'Finish ChatGPT setup'
                : target
                  ? `Set up ${target.name}`
                  : 'Add connection'}
          </h3>
          {!target && !registration && (
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
          {kind === 'plan' ? (
            preparingRegistration && registration ? (
              <>
                <label className="field">
                  Name to paste in ChatGPT
                  <input
                    ref={suggestedNameInput}
                    readOnly
                    value={registration.name}
                    onFocus={(e) => e.target.select()}
                  />
                </label>
                <p className="small">
                  ChatGPT starts with Saul. Replace it with the copied name before you approve.
                </p>
                <div className="row">
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => void copyAndSignIn(registration.name)}
                  >
                    Copy name and open ChatGPT
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setRegistration(undefined);
                      setError('');
                    }}
                  >
                    Back
                  </button>
                </div>
              </>
            ) : (
              <>
                {boundPlan || finishingRegistration ? (
                  <p className="small">Account · {selectedAccount?.label ?? 'Loading…'}</p>
                ) : (
                  <label className="field">
                    Saved account
                    <select
                      value={accountId}
                      onChange={(e) => {
                        setAccountId(e.target.value);
                        setRegistration(undefined);
                        setError('');
                      }}
                    >
                      <option value="">Choose an account</option>
                      {accounts
                        .filter(
                          (account) =>
                            !settings.connections.some(
                              (connection) => connection.accountId === account.id,
                            ),
                        )
                        .map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.label}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                {!boundPlan && planReady && (
                  <>
                    {registration && (
                      <label className="row">
                        <input
                          type="checkbox"
                          checked={!!registration.confirmed}
                          onChange={(e) =>
                            setRegistration({ ...registration, confirmed: e.target.checked })
                          }
                        />
                        I used {registration.name} in ChatGPT
                      </label>
                    )}
                    {!target && (
                      <label className="field">
                        Connection name
                        <input
                          maxLength={80}
                          placeholder="ChatGPT plan"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                        />
                      </label>
                    )}
                  </>
                )}
                {(boundPlan || (!planReady && selectedAccount)) && (
                  <button type="button" className="btn primary" onClick={() => void signIn()}>
                    {needsPlanPermission ? 'Enable plan use' : 'Sign in again'}
                  </button>
                )}
                {!boundPlan && !registration && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setError('');
                      setRegistration({
                        name: `Saul ${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
                      });
                    }}
                  >
                    Register a new app
                  </button>
                )}
              </>
            )
          ) : (
            <>
              {!target && (
                <label className="field">
                  Name
                  <input maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
                </label>
              )}
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
          {!preparingRegistration && (
            <div className="row">
              {(kind !== 'plan' || (!boundPlan && planReady)) && (
                <button type="button" className="btn primary" onClick={() => void save()}>
                  {kind === 'plan' ? 'Save connection' : 'Save'}
                </button>
              )}
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
          )}
        </fieldset>
      ) : (
        visible &&
        settings.connections.map((connection) => (
          <ConnectionRow
            key={JSON.stringify([
              connection.key,
              connection.accountId,
              connection.baseUrl,
              revision,
            ])}
            connection={connection}
            enabled={enabled}
            locked={busy || disabled}
            dirty={dirty}
            logout={connection.accountId ? logouts.get(connection.accountId) : undefined}
            reveal={focusConnection === connection.key}
            onRevealed={onConnectionFocused}
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
