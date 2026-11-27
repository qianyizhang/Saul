import {
  validConnectionEndpoint,
  type ConnectionDefinition,
} from '../../shared/protocol/shared-presets-contract.mts';
import { credentialCall } from '../native/credentials';
import { planCall } from '../providers/chatgpt-plan';
import type { Configuration } from '../configuration/definition';
import type { ConnectionReservation } from '../../shared/protocol/connection-coordination.mts';
import type { PlanAccount, PlanResults } from '../../shared/protocol/credential-plan.mts';
import {
  changeOutsideSetup,
  connectionAccounts,
  connectionRecovery,
  connectionSetups,
  releaseSetup,
  discardConnectionSetup,
  withReviewedConnectionSetup,
  type CommitSetup,
} from './client';
import { ConnectionSetupNotAdmitted, observeConnectionSetups, type ConnectionSetup } from './setup';
import { nextName } from '../settings/draft';
import type { ConnectionChange } from '../settings/connection-management';

type Logout = PlanResults['logout'];
const message = (cause: unknown) => (cause instanceof Error ? cause.message : 'Connection failed.');
const officialEndpoint = 'https://api.openai.com/v1';
type SetupFields = {
  kind: 'plan' | 'api' | 'custom';
  name: string;
  endpoint: string;
  key: string;
  accountId: string;
};
type SetupDraft = {
  id: string;
  target?: ConnectionDefinition;
  fields: SetupFields;
  registration?: { name: string; accountId?: string; confirmed?: boolean };
};

function sameSetup(current: ConnectionSetup | undefined, reviewed: ConnectionSetup) {
  return current?.id === reviewed.id && current.phase === reviewed.phase;
}

export type ConnectionEditorOptions = {
  settings: Configuration;
  commit: CommitSetup;
  manageConnection: (change: ConnectionChange) => Promise<void>;
  onDirty: (dirty: boolean) => void;
};

export function createConnectionEditor(options: ConnectionEditorOptions) {
  let draft: SetupDraft | undefined;
  let accounts: PlanAccount[] = [];
  let logouts: ReadonlyMap<string, Logout> = new Map();
  let error = '';
  let revision = 0;
  let pendingSetups: ConnectionSetup[] = [];
  let reviewedSetupId: string | undefined;
  let foreignSetups: ConnectionReservation[] = [];
  let active = false;
  let operation = false;
  let accountRead: AbortController | undefined;
  let loginController: AbortController | undefined;
  let pendingRead = 0;
  let submittedIdentity: string | undefined;
  let savingIdentity: string | undefined;

  const listeners = new Set<() => void>();
  function publish() {
    current = snapshot();
    for (const listener of listeners) listener();
  }
  function setDraft(
    next: SetupDraft | undefined | ((current: SetupDraft | undefined) => SetupDraft | undefined),
  ) {
    draft = typeof next === 'function' ? next(draft) : next;
    publish();
  }
  function setError(next: string) {
    error = next;
    publish();
  }
  function updateLogouts(
    update: (previous: ReadonlyMap<string, Logout>) => ReadonlyMap<string, Logout>,
  ) {
    logouts = update(logouts);
    publish();
  }
  function pending() {
    return (
      (draft &&
        pendingSetups.find(
          (record) => record.definition.key === (draft?.target?.key ?? draft?.id),
        )) ??
      pendingSetups.find((record) => record.id === reviewedSetupId) ??
      pendingSetups[0]
    );
  }

  function retireDraft() {
    submittedIdentity = undefined;
    setDraft(undefined);
    options.onDirty(false);
  }

  async function refreshPending() {
    const token = ++pendingRead;
    try {
      const records = await connectionRecovery();
      if (!active || token !== pendingRead) return;
      const shouldReadAccounts = !pending()?.definition.accountId;
      pendingSetups = records;
      if (
        submittedIdentity &&
        draft?.id === submittedIdentity &&
        savingIdentity !== submittedIdentity &&
        !records.some((setup) => setup.id === submittedIdentity)
      ) {
        retireDraft();
        revision++;
      }
      publish();
      if (shouldReadAccounts && pending()?.definition.accountId) void refreshAccounts();
      if (options.settings.sharedCredentials === 'saul') {
        const remote = await connectionSetups().catch(() => []);
        if (!active || token !== pendingRead) return;
        foreignSetups = remote.filter((setup) => setup.origin === 'ez');
        publish();
      }
    } catch (cause) {
      if (active && token === pendingRead) setError(message(cause));
    }
  }

  async function readAccounts(signal?: AbortSignal) {
    accountRead?.abort();
    const controller = new AbortController();
    accountRead = controller;
    const currentSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
    try {
      const result = await connectionAccounts();
      if (active && !currentSignal.aborted) {
        accounts = result.accounts;
        publish();
        return accounts;
      }
    } catch (cause) {
      if (active && !currentSignal.aborted) throw cause;
    }
  }

  async function refreshAccounts() {
    try {
      await readAccounts();
    } catch (cause) {
      if (active) setError(message(cause));
    }
  }

  async function run(work: () => Promise<void>) {
    if (operation) return;
    operation = true;
    setError('');
    try {
      await work();
    } catch (cause) {
      if (active) setError(message(cause));
    } finally {
      operation = false;
      if (active) publish();
    }
  }

  function close() {
    loginController?.abort();
    retireDraft();
    setError('');
  }

  function complete() {
    if (!active) return;
    close();
    {
      revision++;
      publish();
    }
  }

  function open(connection?: ConnectionDefinition) {
    if (operation || pendingSetups.some((setup) => setup.definition.key === connection?.key))
      return;
    options.onDirty(true);
    setError('');
    const id = `connection-${crypto.randomUUID()}`;
    setDraft({
      id,
      target: connection,
      fields: {
        kind:
          connection?.kind === 'openai-api'
            ? connection.baseUrl && connection.baseUrl !== officialEndpoint
              ? 'custom'
              : 'api'
            : 'plan',
        name: connection?.name ?? '',
        accountId: connection?.accountId ?? '',
        key: '',
        endpoint: connection?.baseUrl ?? officialEndpoint,
      },
    });
    if (draft?.fields.kind === 'plan') void refreshAccounts();
  }

  function update(fields: Partial<SetupFields>) {
    setDraft(
      (current) =>
        current && {
          ...current,
          fields: { ...current.fields, ...fields },
          registration: fields.accountId === undefined ? current.registration : undefined,
        },
    );
    if (fields.kind !== undefined || fields.accountId !== undefined) setError('');
    if (fields.kind === 'plan') void refreshAccounts();
  }

  function register() {
    setError('');
    setDraft(
      (current) =>
        current && {
          ...current,
          registration: {
            name: `Saul ${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
          },
        },
    );
  }

  function backFromRegistration() {
    setError('');
    setDraft((current) => current && { ...current, registration: undefined });
  }

  function confirmRegistration(confirmed: boolean) {
    setDraft((current) =>
      current?.registration
        ? { ...current, registration: { ...current.registration, confirmed } }
        : current,
    );
  }

  async function save() {
    const editing = draft;
    if (!editing) return;
    await run(async () => {
      const { id, target, fields, registration } = editing;
      const connectionKey = target?.key ?? id;
      let definition: ConnectionDefinition;
      if (fields.kind === 'plan') {
        const account = accounts.find(
          (a) => a.id === fields.accountId && a.signedIn && a.planEnabled,
        );
        if (!account) throw new Error('Sign in and allow plan use before saving this connection.');
        if (target?.accountId && target.accountId !== account.id)
          throw new Error('This connection is bound to another account.');
        if (
          options.settings.connections.some(
            (c) => c.key !== connectionKey && c.accountId === account.id,
          )
        )
          throw new Error('This account already has a connection.');
        definition = {
          key: connectionKey,
          name:
            target?.name ??
            (fields.name.trim() || nextName('ChatGPT plan', options.settings.connections)),
          kind: 'chatgpt-plan',
          accountId: account.id,
        };
      } else {
        const url =
          fields.kind === 'api' ? officialEndpoint : fields.endpoint.trim().replace(/\/+$/, '');
        if (!validConnectionEndpoint(url))
          throw new Error(
            'Use HTTPS, or HTTP on localhost, without credentials or query parameters.',
          );
        definition = {
          key: connectionKey,
          name: target?.name ?? fields.name.trim(),
          kind: 'openai-api',
          baseUrl: url,
        };
        if (!definition.name) throw new Error('Name this connection.');
      }
      savingIdentity = id;
      try {
        await options.commit(
          {
            id,
            definition,
            previous: target,
            phase: 'credential',
            ...(registration?.confirmed &&
              registration.accountId === fields.accountId && {
                confirmedName: registration.name,
              }),
          },
          fields.key,
          pending()?.id === id,
        );
        complete();
      } catch (error) {
        if (error instanceof ConnectionSetupNotAdmitted) submittedIdentity = undefined;
        throw error;
      } finally {
        savingIdentity = undefined;
        await refreshPending();
      }
    });
  }

  async function resume(setup: ConnectionSetup, key: string) {
    await run(async () => {
      try {
        await options.commit(setup, key, true);
        complete();
      } finally {
        await refreshPending();
      }
    });
  }

  async function discard(setup: ConnectionSetup) {
    await run(async () => {
      try {
        await discardConnectionSetup(setup.id, setup.phase);
        if (active) close();
      } finally {
        await refreshPending();
      }
    });
  }

  async function authorize(work: (signal: AbortSignal) => Promise<void>) {
    await run(async () => {
      const controller = new AbortController();
      loginController = controller;
      publish();
      try {
        await work(controller.signal);
      } finally {
        loginController = undefined;
        if (active) {
          publish();
          if (!controller.signal.aborted) await refreshAccounts();
        }
      }
    });
  }

  async function login(
    request: { accountId: string; consent: boolean } | { suggestedAppName: string },
    signal: AbortSignal,
    accept: (account: PlanAccount) => void,
    setupToken?: string,
  ) {
    signal.throwIfAborted();
    const result = await planCall(
      { action: 'login', consent: false, ...request, ...(setupToken && { setupToken }) },
      AbortSignal.any([signal, AbortSignal.timeout(320_000)]),
    );
    if (signal.aborted || !active) return;
    if (result.account.signedIn)
      updateLogouts((previous) => {
        const next = new Map(previous);
        next.delete(result.account.id);
        return next;
      });
    accept(result.account);
  }

  async function signIn() {
    const editing = draft;
    if (!editing) return;
    const accountId = editing.target?.accountId ?? editing.fields.accountId;
    const needsPlanPermission = snapshot().plan.needsPlanPermission;
    await authorize(async (signal) => {
      if (!accountId) throw new Error('Choose an account to sign in again.');
      await changeOutsideSetup(
        editing.target?.key ?? editing.id,
        editing.target,
        async () => {
          const accounts = await readAccounts(signal);
          if (!accounts) return;
          const current = accounts.find((account) => account.id === accountId);
          const consent = !!(current?.signedIn && !current.planEnabled);
          if (consent && !needsPlanPermission)
            throw new Error('The account status changed. Choose Enable plan use.');
          await login({ accountId, consent }, signal, (account) => {
            setDraft(
              (current) =>
                current && { ...current, fields: { ...current.fields, accountId: account.id } },
            );
            if (account.planEnabled && editing.target?.accountId) complete();
            else if (!account.planEnabled)
              setError('ChatGPT plan use is still disabled for this account.');
          });
        },
        accountId,
        signal,
      );
    });
  }

  async function copyAndSignIn() {
    const editing = draft;
    if (!editing) return;
    const name = editing.registration?.name;
    if (!name) return;
    await authorize(async (signal) => {
      try {
        await navigator.clipboard.writeText(name);
      } catch {
        throw new Error('Could not copy the app name. Try again.');
      }
      try {
        await changeOutsideSetup(
          editing.target?.key ?? editing.id,
          editing.target,
          async () => {
            await login({ suggestedAppName: name }, signal, (account) => {
              setDraft(
                (current) =>
                  current && {
                    ...current,
                    fields: { ...current.fields, accountId: account.id },
                    registration: { name, accountId: account.id },
                  },
              );
              if (!account.planEnabled)
                setError('ChatGPT plan use is still disabled for this account.');
            });
          },
          undefined,
          signal,
        );
      } catch (cause) {
        if (active) setDraft((current) => current && { ...current, registration: undefined });
        throw cause;
      }
    });
  }

  async function repairAccount(setup: ConnectionSetup, intent: 'enable' | 'sign-in' | 'check') {
    const accountId = setup.definition.accountId;
    if (!accountId) return;
    const findAccount = async (signal?: AbortSignal) => {
      const accounts = await readAccounts(signal);
      if (!accounts) return;
      const account = accounts.find((item) => item.id === accountId);
      if (!account)
        throw new Error(
          'The original account is unavailable. Discard this setup and choose an account.',
        );
      return account;
    };
    if (intent === 'check') {
      await run(async () => {
        if (
          !sameSetup(
            (await connectionRecovery()).find(
              (item) => item.definition.key === setup.definition.key,
            ),
            setup,
          )
        )
          throw new Error('Connection setup changed. Review the current setup before continuing.');
        await findAccount();
      });
      return;
    }
    await authorize(async (signal) => {
      try {
        await withReviewedConnectionSetup(
          setup,
          async (token, lifetime) => {
            const account = await findAccount(lifetime);
            if (!account || (account.signedIn && account.planEnabled)) return;
            if (account.signedIn !== (intent === 'enable'))
              throw new Error('The account status changed. Choose the updated action.');
            await login(
              { accountId, consent: intent === 'enable' },
              lifetime ?? signal,
              (signedIn) => {
                if (signedIn.id !== accountId || !signedIn.signedIn || !signedIn.planEnabled)
                  setError('The original account is unavailable for plan use.');
              },
              token,
            );
          },
          signal,
        );
      } finally {
        await refreshPending();
      }
    });
  }

  async function disconnect(connection: ConnectionDefinition) {
    await run(async () => {
      await changeOutsideSetup(connection.key, connection, async () => {
        if (connection.kind === 'chatgpt-plan') {
          if (!connection.accountId) throw new Error('This connection has no account.');
          const result = await planCall({ action: 'logout', accountId: connection.accountId });
          if (result.account.id !== connection.accountId || result.account.signedIn)
            throw new Error('The helper did not confirm local sign-out.');
          if (active) updateLogouts((previous) => new Map(previous).set(result.account.id, result));
        } else
          await credentialCall({
            action: 'connection-key-remove',
            connectionKey: connection.key,
            endpoint: connection.baseUrl ?? officialEndpoint,
          });
      });
      if (active) {
        revision++;
        publish();
      }
    });
  }

  function snapshot() {
    const selectedAccount = accounts.find((account) => account.id === draft?.fields.accountId);
    const recoveryAccount = pending()?.definition.accountId;
    const originalAccount = accounts.find((account) => account.id === recoveryAccount);
    const recoveryIntent = originalAccount
      ? originalAccount.planEnabled && originalAccount.signedIn
        ? undefined
        : originalAccount.signedIn
          ? ('enable' as const)
          : ('sign-in' as const)
      : ('check' as const);
    return {
      draft,
      pending: pending(),
      pendingSetups,
      foreignSetups,
      status: { busy: operation, error, signingIn: !!loginController, revision, logouts },
      plan: {
        accounts,
        selectedAccount,
        defaultPlanName: nextName('ChatGPT plan', options.settings.connections),
        needsPlanPermission: !!(selectedAccount?.signedIn && !selectedAccount.planEnabled),
        recoveryIntent,
      },
    };
  }
  let current = snapshot();
  return {
    getSnapshot: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    updateOptions(next: ConnectionEditorOptions) {
      const changedConnectionMode =
        options.settings.sharedCredentials !== next.settings.sharedCredentials;
      options = next;
      publish();
      if (changedConnectionMode) void refreshPending();
    },
    enter() {
      active = true;
      const stopObserving = observeConnectionSetups((recordedIds) => {
        if (savingIdentity && recordedIds.has(savingIdentity)) submittedIdentity = savingIdentity;
        void refreshPending();
      });
      void refreshPending();
      return () => {
        active = false;
        pendingRead++;
        accountRead?.abort();
        loginController?.abort();
        stopObserving();
      };
    },
    open,
    close,
    update,
    register,
    backFromRegistration,
    confirmRegistration,
    copyAndSignIn,
    signIn,
    cancelSignIn: () => loginController?.abort(),
    save,
    resume,
    discard,
    repairAccount,
    disconnect,
    manage: (connection: ConnectionDefinition, change: ConnectionChange) =>
      changeOutsideSetup(change.key, connection, () => options.manageConnection(change)),
    release: (setup: ConnectionReservation) =>
      run(async () => {
        await releaseSetup({ connectionKey: setup.connectionKey, token: setup.token });
        await refreshPending();
      }),
    refreshPending,
    reviewSetup(id: string) {
      reviewedSetupId = id;
      publish();
    },
    clearError: () => setError(''),
  };
}
