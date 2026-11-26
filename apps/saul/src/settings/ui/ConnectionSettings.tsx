import { useCallback, useEffect, useRef, useState } from 'react';
import {
  connectionCapabilities,
  type ConnectionDefinition,
} from '../../../shared/protocol/shared-presets-contract.mts';
import {
  validConnectionStatus,
  type ConnectionStatus,
} from '../../../shared/protocol/connections-contract.mts';
import { credentialCall } from '../../native/credentials';
import type { ModelPreset } from '../../../shared/model/presets.ts';
import type { PlanResults } from '../../../shared/protocol/credential-plan.mts';
import { useConnectionCatalog } from './useConnectionCatalog';
import { ConnectionManagement, type ConnectionManagementAction } from './ConnectionManagement';
import { presetCountLabel, presetsUsingConnection } from '../connection-management';
import { changeOutsideSetup } from '../../connections/client';
import { useConnectionSetup } from '../useConnectionSetup';
import type { Configuration } from '../../configuration/definition';
import type { ConnectionChange } from '../connection-management';
import type { CommitSetup } from '../../connections/client';

type Logout = PlanResults['logout'];
const message = (cause: unknown) => (cause instanceof Error ? cause.message : 'Connection failed.');

function PlanSignInAction({
  label,
  onClick,
  primary = false,
}: {
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  const className = primary ? 'btn primary' : 'btn';
  // Opening the authorization tab dismisses Chrome's toolbar popup.
  if (document.documentElement.classList.contains('toolbar-popup')) {
    return (
      <a
        className={className}
        href={chrome.runtime.getURL('library.html?section=connections#settings')}
        target="_blank"
        rel="noreferrer"
      >
        Open Connections in a tab
      </a>
    );
  }
  return (
    <button type="button" className={className} onClick={onClick}>
      {label}
    </button>
  );
}

function ConnectionRow({
  connection,
  presetCount,
  enabled,
  locked,
  dirty,
  logout,
  reveal,
  onRevealed,
  setup,
  remove,
  manage,
  integrations,
}: {
  connection: ConnectionDefinition;
  presetCount: number;
  enabled: boolean;
  locked: boolean;
  dirty: boolean;
  logout?: Logout;
  reveal: boolean;
  onRevealed: () => void;
  setup: () => void;
  remove: () => void;
  manage: (action: ConnectionManagementAction) => void;
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
        <div className="row">
          <strong>{connection.name}</strong>
          <span className="small muted standard-only">{presetCountLabel(presetCount)}</span>
        </div>
        <details className="connection-more">
          <summary aria-label={`More for ${connection.name}`}>···</summary>
          <div className="stack">
            <button
              type="button"
              className="btn"
              disabled={locked || dirty}
              onClick={() => manage('rename')}
            >
              Rename connection
            </button>
            {presetCount > 0 && (
              <button
                type="button"
                className="btn"
                disabled={locked || dirty}
                onClick={() => manage('move')}
              >
                Move presets
              </button>
            )}
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
            <button
              type="button"
              className="btn danger"
              disabled={locked || dirty}
              onClick={() => manage('delete')}
            >
              Delete connection
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

type ConnectionSettingsProps = {
  settings: Configuration;
  visible: boolean;
  disabled: boolean;
  dirty: boolean;
  commit: CommitSetup;
  manageConnection: (change: ConnectionChange) => Promise<void>;
  integrations: () => void;
  onDirty: (dirty: boolean) => void;
  focusConnection?: string;
  onConnectionFocused: () => void;
};

export function ConnectionSettings({
  settings,
  visible,
  disabled,
  dirty,
  commit,
  manageConnection,
  integrations,
  onDirty,
  focusConnection,
  onConnectionFocused,
}: ConnectionSettingsProps) {
  const setup = useConnectionSetup({ settings, onDirty, commit }, visible);
  const { draft, pending, status, plan } = setup;
  const { busy, error, revision, logouts } = status;
  const { accounts, selectedAccount, defaultPlanName, needsPlanPermission, recoveryIntent } = plan;
  const [management, setManagement] = useState<{
    key: string;
    action: ConnectionManagementAction;
  }>();
  const [returnTo, setReturnTo] = useState<string>();
  const [recoveryKey, setRecoveryKey] = useState<{ id: string; value: string }>();
  const pendingId = pending?.id;
  const targetsPending = pending?.id === draft?.id && pending?.phase === 'credential';
  const editing =
    !pending || targetsPending || pending.definition.key !== (draft?.target?.key ?? draft?.id)
      ? draft
      : undefined;
  const enabled = settings.sharedCredentials === 'saul';
  const planReady = !!(selectedAccount?.signedIn && selectedAccount.planEnabled);
  const target = draft?.target;
  const registration = draft?.registration;
  const preparingRegistration = !!registration && !registration.accountId;
  const finishingRegistration = !!registration?.accountId;
  const boundPlan = draft?.fields.kind === 'plan' && !!target?.accountId;
  const managed = settings.connections.find((connection) => connection.key === management?.key);
  const returningAfterDelete =
    !!returnTo && !settings.connections.some((connection) => connection.key === returnTo);
  useEffect(() => {
    setRecoveryKey(undefined);
  }, [pendingId, pending?.phase]);
  const suggestedNameInput = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (returningAfterDelete) addButton.current?.focus();
  }, [returningAfterDelete]);
  useEffect(() => {
    if (preparingRegistration) suggestedNameInput.current?.focus();
  }, [preparingRegistration]);
  const remove = async (connection: ConnectionDefinition) => {
    const action =
      connection.kind === 'chatgpt-plan' ? 'Sign out of this account' : 'Remove this API key';
    if (
      !window.confirm(
        `${action} in both Saul and EZ? Presets keep this connection and will show that setup is required.`,
      )
    )
      return;
    await setup.disconnect(connection);
  };
  return (
    <section hidden={!visible} className="settings-section" aria-label="Connections">
      <div className="row between">
        <h2 className="view-title">Connections</h2>
        {!draft && !management && (
          <button
            ref={addButton}
            type="button"
            className="btn"
            disabled={disabled || dirty || busy || !enabled || settings.connections.length >= 32}
            onClick={() => setup.open()}
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
      {!editing &&
        setup.foreignSetups.map((reservation) => {
          const name =
            settings.connections.find((connection) => connection.key === reservation.connectionKey)
              ?.name ?? reservation.connectionKey;
          return (
            <div className="row between" key={reservation.token}>
              <span>EZ setup for {name}</span>
              {reservation.active ? (
                <button type="button" className="btn" onClick={() => void setup.refreshPending()}>
                  Active in EZ · Check again
                </button>
              ) : (
                <button
                  type="button"
                  className="btn"
                  disabled={busy || dirty || disabled}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Release the setup for ${name} from EZ? The credential may already have changed. Releasing keeps the current credential and saved connection.`,
                      )
                    )
                      void setup.release(reservation);
                  }}
                >
                  Release setup
                </button>
              )}
            </div>
          );
        })}
      {!editing &&
        setup.pendingSetups
          .filter((record) => record.id !== pending?.id)
          .map((record) => (
            <button
              type="button"
              className="btn"
              key={record.id}
              disabled={busy}
              onClick={() => setup.reviewSetup(record.id)}
            >
              Review setup for {record.definition.name}
            </button>
          ))}
      {pending && !editing && (
        <fieldset className="stack settings-fields" disabled={busy || dirty || disabled}>
          <h3>Finish setting up {pending.definition.name}</h3>
          <p>{pending.definition.baseUrl ?? pending.definition.accountId}</p>
          <p role="status">
            {pending.phase === 'settings'
              ? pending.definition.kind === 'openai-api'
                ? 'The helper accepted the key. Finish setup checks the saved connection.'
                : 'Account setup finished. Finish setup checks the saved connection.'
              : 'The credential change was not confirmed. Review before submitting it again.'}
          </p>
          {pending.phase === 'credential' && pending.definition.kind === 'openai-api' && (
            <label className="field">
              API key
              <input
                type="password"
                autoComplete="off"
                value={recoveryKey?.id === pending.id ? recoveryKey.value : ''}
                onChange={(e) => setRecoveryKey({ id: pending.id, value: e.target.value })}
              />
            </label>
          )}
          <div className="row">
            {pending.definition.kind === 'chatgpt-plan' && recoveryIntent === 'check' && (
              <button
                type="button"
                className="btn"
                onClick={() => void setup.repairAccount(pending, 'check')}
              >
                Check original account
              </button>
            )}
            {pending.definition.kind === 'chatgpt-plan' &&
              recoveryIntent &&
              recoveryIntent !== 'check' && (
                <PlanSignInAction
                  label={
                    recoveryIntent === 'enable' ? 'Enable plan use' : 'Sign in to original account'
                  }
                  onClick={() => void setup.repairAccount(pending, recoveryIntent)}
                />
              )}
            <button
              type="button"
              className="btn primary"
              onClick={() =>
                void setup.resume(
                  pending,
                  pending.phase === 'credential' && recoveryKey?.id === pending.id
                    ? recoveryKey.value
                    : '',
                )
              }
            >
              {pending.phase === 'settings' ? 'Finish setup' : 'Submit again'}
            </button>
            <button type="button" className="btn" onClick={() => void setup.discard(pending)}>
              Discard setup
            </button>
          </div>
        </fieldset>
      )}
      {status.signingIn && (
        <div className="row">
          <span role="status">Waiting for ChatGPT…</span>
          <button type="button" className="btn" onClick={setup.cancelSignIn}>
            Cancel sign-in
          </button>
        </div>
      )}
      {management && managed ? (
        <ConnectionManagement
          key={management.action}
          action={management.action}
          connection={managed}
          settings={settings}
          disabled={disabled || dirty}
          commit={(change) =>
            changeOutsideSetup(change.key, managed, () => manageConnection(change))
          }
          close={() => {
            setReturnTo(management.key);
            setManagement(undefined);
            onDirty(false);
          }}
          openMove={() => setManagement({ key: management.key, action: 'move' })}
        />
      ) : editing ? (
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
                value={editing.fields.kind}
                onChange={(e) =>
                  setup.update({ kind: e.target.value as typeof editing.fields.kind })
                }
              >
                <option value="plan">ChatGPT plan</option>
                <option value="api">OpenAI API</option>
                <option value="custom">Custom endpoint</option>
              </select>
            </label>
          )}
          {editing.fields.kind === 'plan' ? (
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
                    onClick={() => void setup.copyAndSignIn()}
                  >
                    Copy name and open ChatGPT
                  </button>
                  <button type="button" className="btn" onClick={setup.backFromRegistration}>
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
                      value={editing.fields.accountId}
                      onChange={(e) => setup.update({ accountId: e.target.value })}
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
                          onChange={(e) => setup.confirmRegistration(e.target.checked)}
                        />
                        I used {registration.name} in ChatGPT
                      </label>
                    )}
                    {!target && (
                      <label className="field">
                        Connection name
                        <input
                          maxLength={80}
                          placeholder={defaultPlanName}
                          value={editing.fields.name}
                          onChange={(e) => setup.update({ name: e.target.value })}
                        />
                      </label>
                    )}
                  </>
                )}
                {(boundPlan || (!planReady && selectedAccount)) && (
                  <PlanSignInAction
                    label={needsPlanPermission ? 'Enable plan use' : 'Sign in again'}
                    onClick={() => void setup.signIn()}
                    primary
                  />
                )}
                {!boundPlan && !registration && (
                  <PlanSignInAction label="Register a new app" onClick={setup.register} />
                )}
              </>
            )
          ) : (
            <>
              {!target && (
                <label className="field">
                  Name
                  <input
                    maxLength={80}
                    value={editing.fields.name}
                    onChange={(e) => setup.update({ name: e.target.value })}
                  />
                </label>
              )}
              {editing.fields.kind === 'custom' && (
                <label className="field">
                  Endpoint
                  <input
                    value={editing.fields.endpoint}
                    disabled={!!target?.baseUrl}
                    onChange={(e) => setup.update({ endpoint: e.target.value })}
                    placeholder="https://example.com/v1"
                  />
                </label>
              )}
              <label className="field">
                API key
                <input
                  type="password"
                  autoComplete="off"
                  value={editing.fields.key}
                  onChange={(e) => setup.update({ key: e.target.value })}
                  placeholder={
                    editing.fields.kind === 'custom' ? 'Optional for localhost' : 'API key'
                  }
                />
              </label>
              <p className="small">
                {editing.fields.kind === 'api'
                  ? 'OpenAI API billing is separate from your ChatGPT plan.'
                  : 'Uses this endpoint’s billing. Keys stay bound to this endpoint.'}
              </p>
            </>
          )}
          {!preparingRegistration && (
            <div className="row">
              {(editing.fields.kind !== 'plan' || (!boundPlan && planReady)) && (
                <button type="button" className="btn primary" onClick={() => void setup.save()}>
                  {editing.fields.kind === 'plan' ? 'Save connection' : 'Save'}
                </button>
              )}
              <button type="button" className="btn" onClick={setup.close}>
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
            presetCount={presetsUsingConnection(settings, connection.key).length}
            enabled={enabled}
            locked={
              busy ||
              disabled ||
              setup.pendingSetups.some((record) => record.definition.key === connection.key)
            }
            dirty={dirty}
            logout={connection.accountId ? logouts.get(connection.accountId) : undefined}
            reveal={(focusConnection ?? returnTo) === connection.key}
            onRevealed={() => {
              setReturnTo(undefined);
              onConnectionFocused();
            }}
            setup={() => {
              if (!dirty && !disabled) setup.open(connection);
            }}
            remove={() => void remove(connection)}
            manage={(action) => {
              setup.clearError();
              setManagement({ key: connection.key, action });
              onDirty(true);
            }}
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
