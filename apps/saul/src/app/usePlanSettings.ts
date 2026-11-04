import { useEffect, useRef, useState } from 'react';
import { planCall } from '../models/chatgpt-plan';
import type { PlanAccount, PlanModel } from '../../native/plan-protocol.mts';
import type { UserSettings } from '../types';
import { planModelDefaults, planModelIssue } from '../../native/plan-models.mts';
import { useMinimumMode } from './useMinimumMode';

export function usePlanSettings(
  value: NonNullable<UserSettings['chatgptPlan']>,
  onChange: (value: NonNullable<UserSettings['chatgptPlan']>) => void,
  onBusyChange: (busy: boolean) => void,
  enabled: boolean,
) {
  const { minimum } = useMinimumMode();
  const [accounts, setAccounts] = useState<PlanAccount[]>([]);
  const [models, setModels] = useState<PlanModel[]>([]);
  const [busy, setBusy] = useState<'accounts' | 'login' | 'logout' | 'models' | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [welcome, setWelcome] = useState(false);
  const [helperReady, setHelperReady] = useState<boolean | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsReady, setModelsReady] = useState(false);
  const current = useRef({ value, onChange });
  current.current = { value, onChange };
  const mounted = useRef(true),
    controller = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const active = accounts.find((a) => a.id === value.accountId);
  const selectedModel = models.find((model) => model.slug === value.model);
  const modelIssue = modelsReady && value.model ? planModelIssue(value, models) : undefined;
  useEffect(() => {
    onBusyChange?.(!!busy || loadingModels);
    return () => onBusyChange?.(false);
  }, [busy, loadingModels, onBusyChange]);
  useEffect(() => {
    if (!enabled) return;
    mounted.current = true;
    const refresh = (selectSoleAccount = false) => {
      void planCall({ action: 'accounts' })
        .then((r) => {
          if (!mounted.current) return;
          setHelperReady(true);
          setAccounts(r.accounts);
          const selected = current.current.value.accountId;
          const account = selected
            ? r.accounts.find((a) => a.id === selected)
            : selectSoleAccount && r.accounts.length === 1
              ? r.accounts[0]
              : undefined;
          if (account && account.id !== current.current.value.accountId)
            current.current.onChange({ ...current.current.value, accountId: account.id });
        })
        .catch((e) => {
          if (mounted.current) {
            setHelperReady(false);
            setError(e.message);
          }
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
    refresh(true);
    return () => {
      mounted.current = false;
      // Login belongs to the background owner and survives a popup closing for OAuth.
      revision.current++;
      chrome.runtime.onMessage.removeListener(changed);
    };
  }, [enabled]);
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
    revision.current++;
    setLoadingModels(false);
    if (!enabled || !active?.planEnabled) return;
    const ac = new AbortController();
    setLoadingModels(true);
    void loadModels(active.id, ac.signal)
      .catch((e) => {
        if (!ac.signal.aborted && mounted.current) setError(e.message);
      })
      .finally(() => {
        if (mounted.current && !ac.signal.aborted) setLoadingModels(false);
      });
    return () => {
      ac.abort();
    };
  }, [active?.id, active?.planEnabled, enabled]);
  async function operation(
    action: NonNullable<typeof busy>,
    fn: (signal: AbortSignal) => Promise<void>,
  ) {
    if (controller.current) return;
    const ac = new AbortController();
    controller.current = ac;
    setBusy(action);
    setError('');
    setNotice('');
    try {
      await fn(ac.signal);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'ChatGPT operation failed.');
    } finally {
      controller.current = null;
      if (mounted.current) setBusy(null);
    }
  }
  async function loadModels(accountId: string, signal: AbortSignal) {
    const stamp = ++revision.current;
    setModelsReady(false);
    const result = await planCall({ action: 'models', accountId }, signal);
    if (
      !mounted.current ||
      revision.current !== stamp ||
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
    operation('login', async (signal) => {
      const result = await planCall(
        {
          action: 'login',
          ...(!newAccount && value.accountId ? { accountId: value.accountId } : {}),
          ...(consent ? { consent: true } : {}),
        },
        signal,
      );
      if (!mounted.current) return;
      const account = result.account;
      setAccounts((all) => [...all.filter((a) => a.id !== account.id), account]);
      onChange({ ...current.current.value, accountId: account.id });
      if (account.planEnabled) {
        setNotice('Signed in. Save to use this account.');
      } else
        setNotice('Signed in, but ChatGPT plan permission is disabled. Enable plan usage below.');
    });
  return {
    value,
    onChange,
    accounts,
    models,
    busy,
    error,
    notice,
    helperReady,
    loadingModels,
    modelsReady,
    active,
    selectedModel,
    modelIssue,
    operation,
    login,
    loadModels,
    controller,
    mounted,
    setAccounts,
    setModels,
    setNotice,
    setError,
    setHelperReady,
    welcome,
    setWelcome,
  };
}
export type PlanSettingsState = ReturnType<typeof usePlanSettings>;
