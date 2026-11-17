import { useEffect, useRef, useState } from 'react';
import { planCall } from '../providers/chatgpt-plan';
import type { PlanAccount, PlanModel } from '../../native/plan-protocol.mts';
import type { Configuration } from '../configuration/definition';
import { planModelDefaults, planModelIssue } from '../../native/plan-models.mts';
import { useMinimumMode } from './useMinimumMode';

type PlanCommand = 'accounts' | 'login' | 'logout' | 'models';

export function usePlanSettings(
  value: NonNullable<Configuration['chatgptPlan']>,
  onChange: (value: NonNullable<Configuration['chatgptPlan']>) => void,
  onBusyChange: (busy: boolean) => void,
  enabled: boolean,
  credentialOwner?: Configuration['sharedCredentials'],
) {
  const { minimum } = useMinimumMode();
  const [accounts, setAccounts] = useState<PlanAccount[]>([]);
  const [models, setModels] = useState<PlanModel[]>([]);
  const [busy, setBusy] = useState<PlanCommand | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [welcome, setWelcome] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsReady, setModelsReady] = useState(false);
  const current = useRef({ value, onChange });
  current.current = { value, onChange };
  const owner = useRef(0);
  const command = useRef<{ controller: AbortController; action: PlanCommand } | null>(null);
  const accountsRead = useRef<AbortController | null>(null);
  const modelRevision = useRef(0);
  const active = accounts.find((a) => a.id === value.accountId);
  const selectedModel = models.find((model) => model.slug === value.model);
  const modelIssue = modelsReady && value.model ? planModelIssue(value, models) : undefined;
  useEffect(() => {
    onBusyChange?.(!!busy || loadingModels);
    return () => onBusyChange?.(false);
  }, [busy, loadingModels, onBusyChange]);
  useEffect(() => {
    setBusy(null);
    if (!enabled) return;
    const lifetime = ++owner.current;
    setError('');
    const refresh = (selectSoleAccount = false) => {
      if (command.current) return;
      accountsRead.current?.abort();
      const ac = new AbortController();
      accountsRead.current = ac;
      void loadAccounts(ac.signal, lifetime, selectSoleAccount)
        .catch((error: unknown) => {
          if (!ac.signal.aborted && owner.current === lifetime) setError(message(error));
        })
        .finally(() => {
          if (accountsRead.current === ac) accountsRead.current = null;
        });
    };
    const changed = (
      message: { target?: string; accountId?: string },
      sender: chrome.runtime.MessageSender,
    ) => {
      if (
        sender.id === chrome.runtime.id &&
        !sender.tab &&
        message?.target === 'saul-plan-accounts'
      )
        refresh();
    };
    chrome.runtime.onMessage.addListener(changed);
    const focus = () => refresh();
    window.addEventListener('focus', focus);
    refresh(credentialOwner !== 'saul');
    return () => {
      owner.current++;
      accountsRead.current?.abort();
      // Login belongs to the background owner and survives popup closure.
      if (command.current?.action === 'accounts' || command.current?.action === 'models')
        command.current.controller.abort();
      command.current = null;
      modelRevision.current++;
      chrome.runtime.onMessage.removeListener(changed);
      window.removeEventListener('focus', focus);
    };
  }, [enabled, credentialOwner]);
  useEffect(() => {
    if (minimum || !accounts.some((account) => account.planEnabled)) return;
    let current = true;
    void chrome.storage.local
      .get('saul_chatgpt_welcome_seen')
      .then((saved) => {
        if (current && !saved.saul_chatgpt_welcome_seen) setWelcome(true);
      })
      .catch(() => {
        if (current) setError('Could not read ChatGPT confirmation state.');
      });
    return () => {
      current = false;
    };
  }, [accounts, minimum]);
  // Restore the catalog after returning from the browser, just as after login.
  useEffect(() => {
    setModels([]);
    setModelsReady(false);
    modelRevision.current++;
    setLoadingModels(false);
    if (!enabled || !active?.planEnabled) return;
    const ac = new AbortController();
    const lifetime = owner.current;
    setLoadingModels(true);
    void loadModels(active.id, ac.signal, lifetime)
      .catch((e) => {
        if (!ac.signal.aborted && owner.current === lifetime) setError(e.message);
      })
      .finally(() => {
        if (owner.current === lifetime && !ac.signal.aborted) setLoadingModels(false);
      });
    return () => {
      ac.abort();
    };
  }, [active?.id, active?.planEnabled, enabled]);
  const message = (error: unknown) =>
    error instanceof Error ? error.message : 'ChatGPT operation failed.';

  async function operation(
    action: PlanCommand,
    fn: (signal: AbortSignal, lifetime: number) => Promise<void>,
  ) {
    if (command.current || !enabled) return;
    // An older account list cannot settle after login or logout and restore its
    // stale account status. The mutation's own reply and future reads decide.
    accountsRead.current?.abort();
    const entry = { controller: new AbortController(), action };
    command.current = entry;
    const lifetime = owner.current;
    setBusy(action);
    setError('');
    setNotice('');
    try {
      await fn(entry.controller.signal, lifetime);
    } catch (error) {
      if (owner.current === lifetime) setError(message(error));
    } finally {
      if (command.current === entry) {
        command.current = null;
        if (owner.current === lifetime) setBusy(null);
      }
    }
  }

  async function loadAccounts(signal: AbortSignal, lifetime: number, selectSoleAccount = false) {
    const result = await planCall({ action: 'accounts' }, signal);
    if (signal.aborted || owner.current !== lifetime) return;
    setError('');
    setAccounts(result.accounts);
    if (selectSoleAccount && !current.current.value.accountId && result.accounts.length === 1) {
      const account = result.accounts[0]!;
      current.current.onChange({ ...current.current.value, accountId: account.id });
    }
  }

  async function loadModels(accountId: string, signal: AbortSignal, lifetime: number) {
    const stamp = ++modelRevision.current;
    setModelsReady(false);
    const result = await planCall({ action: 'models', accountId }, signal);
    if (
      signal.aborted ||
      owner.current !== lifetime ||
      modelRevision.current !== stamp ||
      current.current.value.accountId !== accountId
    )
      return;
    const list = result.models;
    setModels(list);
    setModelsReady(true);
    const initial = list.find((model) => model.isDefault) ?? list[0];
    if (!current.current.value.model && initial) {
      current.current.onChange({
        ...current.current.value,
        model: initial.slug,
        ...planModelDefaults(initial),
      });
    }
    if (!list.length) setNotice('No models are available for this ChatGPT account.');
  }
  const login = (newAccount = false, consent = false) =>
    operation('login', async (signal, lifetime) => {
      const result = await planCall(
        {
          action: 'login',
          ...(!newAccount && value.accountId ? { accountId: value.accountId } : {}),
          ...(consent ? { consent: true } : {}),
        },
        signal,
      );
      if (signal.aborted || owner.current !== lifetime) return;
      const account = result.account;
      setAccounts((all) => [...all.filter((a) => a.id !== account.id), account]);
      current.current.onChange({ ...current.current.value, accountId: account.id });
      if (account.planEnabled) {
        setNotice('Signed in. Save to use this account.');
      } else
        setNotice('Signed in, but ChatGPT plan permission is disabled. Enable plan usage below.');
    });
  const logout = () =>
    operation('logout', async (signal, lifetime) => {
      if (!active?.signedIn) return;
      const result = await planCall({ action: 'logout', accountId: active.id }, signal);
      if (signal.aborted || owner.current !== lifetime) return;
      modelRevision.current++;
      setAccounts((all) =>
        all.map((account) => (account.id === result.account.id ? result.account : account)),
      );
      setModels([]);
      setModelsReady(false);
      setNotice(
        result.warning || 'Signed out. Account registration is retained for your next sign-in.',
      );
    });

  return {
    value,
    onChange,
    accounts,
    models,
    busy,
    error,
    notice,
    loadingModels,
    modelsReady,
    active,
    selectedModel,
    modelIssue,
    login,
    logout,
    refreshAccounts: () => operation('accounts', loadAccounts),
    refreshModels: () =>
      operation('models', (signal, lifetime) =>
        loadModels(current.current.value.accountId, signal, lifetime),
      ),
    cancel: () => {
      if (command.current?.action !== 'logout') command.current?.controller.abort();
    },
    welcome,
    dismissWelcome: () => setWelcome(false),
    async confirmWelcome() {
      const lifetime = owner.current;
      try {
        await chrome.storage.local.set({ saul_chatgpt_welcome_seen: true });
        if (owner.current === lifetime) setWelcome(false);
      } catch {
        if (owner.current === lifetime) setError('Could not save confirmation.');
      }
    },
  };
}
export type PlanSettingsState = ReturnType<typeof usePlanSettings>;
