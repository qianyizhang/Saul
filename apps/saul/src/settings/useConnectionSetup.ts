import { useCallback, useEffect, useRef, useState } from 'react';
import {
  validConnectionEndpoint,
  type ConnectionDefinition,
} from '../../shared/protocol/shared-presets-contract.mts';
import { credentialCall } from '../native/credentials';
import { planCall } from '../providers/chatgpt-plan';
import type { Configuration } from '../configuration/definition';
import type { PlanAccount, PlanResults } from '../../shared/protocol/credential-plan.mts';
import {
  changeOutsideSetup,
  connectionSetupKey,
  discardConnectionSetup,
  readConnectionSetup,
  saveConnectionSetup,
  withReviewedConnectionSetup,
  type ConnectionSetup,
  type CommitSetup,
} from './connection-setup';
import { nextName } from './draft';

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

export function useConnectionSetup({
  settings,
  onDirty,
  commit,
}: {
  settings: Configuration;
  commit: CommitSetup;
  onDirty: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<SetupDraft>();
  const [accounts, setAccounts] = useState<PlanAccount[]>([]);
  const [logouts, setLogouts] = useState<ReadonlyMap<string, Logout>>(() => new Map());
  const [busy, setBusy] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState<ConnectionSetup>();
  const active = useRef(false);
  const operation = useRef(false);
  const accountRead = useRef<AbortController | null>(null);
  const loginController = useRef<AbortController | null>(null);
  const pendingRead = useRef(0);
  const draftIdentity = useRef<string | undefined>(undefined);
  const submittedIdentity = useRef<string | undefined>(undefined);
  const savingIdentity = useRef<string | undefined>(undefined);
  const notifyDirty = useRef(onDirty);
  useEffect(() => {
    notifyDirty.current = onDirty;
  }, [onDirty]);

  const retireDraft = useCallback(() => {
    draftIdentity.current = undefined;
    submittedIdentity.current = undefined;
    setDraft(undefined);
    notifyDirty.current(false);
  }, []);
  const refreshPending = useCallback(async () => {
    const token = ++pendingRead.current;
    try {
      const value = await readConnectionSetup();
      if (!active.current || token !== pendingRead.current) return;
      setPending(value);
      const submitted = submittedIdentity.current;
      if (
        submitted &&
        draftIdentity.current === submitted &&
        savingIdentity.current !== submitted &&
        value?.id !== submitted
      ) {
        retireDraft();
        setRevision((revision) => revision + 1);
      }
    } catch (cause) {
      if (active.current && token === pendingRead.current) setError(message(cause));
    }
  }, [retireDraft]);
  useEffect(() => {
    active.current = true;
    const changed = (items: Record<string, chrome.storage.StorageChange>) => {
      if (connectionSetupKey in items) void refreshPending();
    };
    chrome.storage.local.onChanged.addListener(changed);
    void refreshPending();
    return () => {
      active.current = false;
      ++pendingRead.current;
      accountRead.current?.abort();
      loginController.current?.abort();
      chrome.storage.local.onChanged.removeListener(changed);
    };
  }, [refreshPending]);

  const planDraftId = draft?.fields.kind === 'plan' ? draft.id : undefined;
  const recoveryAccount = pending?.definition.accountId;
  const readAccounts = useCallback(async (signal?: AbortSignal) => {
    accountRead.current?.abort();
    const controller = new AbortController();
    accountRead.current = controller;
    try {
      const reply = await planCall(
        { action: 'accounts' },
        AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(20_000),
          ...(signal ? [signal] : []),
        ]),
      );
      if (active.current && !controller.signal.aborted) {
        setAccounts(reply.accounts);
        return reply.accounts;
      }
    } catch (cause) {
      if (active.current && !controller.signal.aborted) throw cause;
    }
  }, []);
  const refreshAccounts = useCallback(async () => {
    try {
      await readAccounts();
    } catch (cause) {
      if (active.current) setError(message(cause));
    }
  }, [readAccounts]);
  useEffect(() => {
    if (planDraftId || recoveryAccount) void refreshAccounts();
    return () => accountRead.current?.abort();
  }, [planDraftId, recoveryAccount, refreshAccounts]);

  async function run(work: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (cause) {
      if (active.current) setError(message(cause));
    } finally {
      operation.current = false;
      if (active.current) setBusy(false);
    }
  }

  function close() {
    retireDraft();
    setError('');
  }

  function complete() {
    if (!active.current) return;
    close();
    setRevision((value) => value + 1);
  }

  function open(connection?: ConnectionDefinition) {
    if (operation.current || pending) return;
    onDirty(true);
    setError('');
    const id = `connection-${crypto.randomUUID()}`;
    draftIdentity.current = id;
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

  const defaultPlanName = nextName('ChatGPT plan', settings.connections);
  async function save() {
    if (!draft || draft.id !== draftIdentity.current) return;
    await run(async () => {
      const { id, target, fields, registration } = draft;
      const connectionKey = target?.key ?? id;
      let definition: ConnectionDefinition;
      if (fields.kind === 'plan') {
        const account = accounts.find(
          (a) => a.id === fields.accountId && a.signedIn && a.planEnabled,
        );
        if (!account) throw new Error('Sign in and allow plan use before saving this connection.');
        if (target?.accountId && target.accountId !== account.id)
          throw new Error('This connection is bound to another account.');
        if (settings.connections.some((c) => c.key !== connectionKey && c.accountId === account.id))
          throw new Error('This account already has a connection.');
        definition = {
          key: connectionKey,
          name: target?.name ?? (fields.name.trim() || defaultPlanName),
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
      savingIdentity.current = id;
      try {
        await saveConnectionSetup(
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
          commit,
          submittedIdentity.current === id || pending?.id === id,
          () => {
            submittedIdentity.current = id;
          },
        );
        complete();
      } finally {
        savingIdentity.current = undefined;
        await refreshPending();
      }
    });
  }

  async function resume(setup: ConnectionSetup, key: string) {
    await run(async () => {
      try {
        await saveConnectionSetup(setup, key, commit, true);
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
        if (active.current) close();
      } finally {
        await refreshPending();
      }
    });
  }

  async function authorize(work: (signal: AbortSignal) => Promise<void>) {
    await run(async () => {
      const controller = new AbortController();
      loginController.current = controller;
      setSigningIn(true);
      try {
        await work(controller.signal);
      } finally {
        loginController.current = null;
        if (active.current) {
          setSigningIn(false);
          if (!controller.signal.aborted) await refreshAccounts();
        }
      }
    });
  }

  async function login(
    request: { accountId: string; consent: boolean } | { suggestedAppName: string },
    signal: AbortSignal,
    accept: (account: PlanAccount) => void,
  ) {
    signal.throwIfAborted();
    const result = await planCall(
      { action: 'login', consent: false, ...request },
      AbortSignal.any([signal, AbortSignal.timeout(320_000)]),
    );
    if (signal.aborted || !active.current) return;
    if (result.account.signedIn)
      setLogouts((previous) => {
        const next = new Map(previous);
        next.delete(result.account.id);
        return next;
      });
    accept(result.account);
  }

  const selectedAccount = accounts.find((account) => account.id === draft?.fields.accountId);
  const needsPlanPermission = !!(selectedAccount?.signedIn && !selectedAccount.planEnabled);
  async function signIn() {
    if (!draft || draft.id !== draftIdentity.current) return;
    const accountId = draft.target?.accountId ?? draft.fields.accountId;
    await authorize(async (signal) => {
      if (!accountId) throw new Error('Choose an account to sign in again.');
      await changeOutsideSetup(
        draft.target?.key ?? draft.id,
        draft.target,
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
            if (account.planEnabled && draft.target?.accountId) complete();
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
    if (!draft || draft.id !== draftIdentity.current) return;
    const name = draft.registration?.name;
    if (!name) return;
    await authorize(async (signal) => {
      try {
        await navigator.clipboard.writeText(name);
      } catch {
        throw new Error('Could not copy the app name. Try again.');
      }
      try {
        await changeOutsideSetup(
          draft.target?.key ?? draft.id,
          draft.target,
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
        if (active.current)
          setDraft((current) => current && { ...current, registration: undefined });
        throw cause;
      }
    });
  }

  const originalAccount = accounts.find((account) => account.id === recoveryAccount);
  const recoveryIntent: 'check' | 'enable' | 'sign-in' | undefined = originalAccount
    ? originalAccount.planEnabled && originalAccount.signedIn
      ? undefined
      : originalAccount.signedIn
        ? 'enable'
        : 'sign-in'
    : 'check';
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
        if (!sameSetup(await readConnectionSetup(), setup))
          throw new Error('Connection setup changed. Review the current setup before continuing.');
        await findAccount();
      });
      return;
    }
    await authorize(async (signal) => {
      try {
        await withReviewedConnectionSetup(
          setup,
          async () => {
            const account = await findAccount(signal);
            if (!account || (account.signedIn && account.planEnabled)) return;
            if (account.signedIn !== (intent === 'enable'))
              throw new Error('The account status changed. Choose the updated action.');
            await login({ accountId, consent: intent === 'enable' }, signal, (signedIn) => {
              if (signedIn.id !== accountId || !signedIn.signedIn || !signedIn.planEnabled)
                setError('The original account is unavailable for plan use.');
            });
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
          if (active.current)
            setLogouts((previous) => new Map(previous).set(result.account.id, result));
        } else
          await credentialCall({
            action: 'connection-key-remove',
            connectionKey: connection.key,
            endpoint: connection.baseUrl ?? officialEndpoint,
          });
      });
      if (active.current) setRevision((value) => value + 1);
    });
  }

  return {
    draft,
    pending,
    status: { busy, error, signingIn, revision, logouts },
    plan: { accounts, selectedAccount, defaultPlanName, needsPlanPermission, recoveryIntent },
    open,
    close,
    update,
    register,
    backFromRegistration,
    confirmRegistration,
    copyAndSignIn,
    signIn,
    cancelSignIn: () => loginController.current?.abort(),
    save,
    resume,
    discard,
    repairAccount,
    disconnect,
    clearError: () => setError(''),
  };
}
