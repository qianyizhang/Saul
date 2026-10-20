import { useEffect, useRef, useState } from 'react';
import { planCall } from '../models/chatgpt-plan';
import type { PlanAccount, PlanModel } from '../../native/plan-protocol.mjs';
import type { UserSettings } from '../types';
import { planModelDefaults, planModelIssue } from '../../native/plan-models.mjs';
import { useMinimumMode } from './useMinimumMode';

export function ChatGPTPlanSettings({
  value,
  onChange,
  test,
  testing,
  saved,
  onBusyChange,
}: {
  value: NonNullable<UserSettings['chatgptPlan']>;
  onChange: (value: NonNullable<UserSettings['chatgptPlan']>) => void;
  test: () => void;
  testing: boolean;
  saved: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
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
  const welcomeDialog = useRef<HTMLDialogElement>(null);
  const active = accounts.find((a) => a.id === value.accountId);
  const selectedModel = models.find((model) => model.slug === value.model);
  const modelIssue = modelsReady && value.model ? planModelIssue(value, models) : undefined;
  useEffect(() => {
    onBusyChange?.(!!busy || loadingModels);
    return () => onBusyChange?.(false);
  }, [busy, loadingModels, onBusyChange]);
  useEffect(() => {
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
      revision.current++;
      chrome.runtime.onMessage.removeListener(changed);
    };
  }, []);
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
  useEffect(() => {
    if (welcome && !minimum) welcomeDialog.current?.showModal();
    else welcomeDialog.current?.close();
  }, [welcome, minimum]);
  // Restore the catalog after returning from the browser, just as after login.
  useEffect(() => {
    setModels([]);
    setModelsReady(false);
    revision.current++;
    setLoadingModels(false);
    if (!active?.planEnabled) return;
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
  }, [active?.id, active?.planEnabled]);
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
        setNotice('Signed in. Choose a model and save Settings to use your plan.');
      } else
        setNotice('Signed in, but ChatGPT plan permission is disabled. Enable plan usage below.');
    });
  return (
    <div className="stack">
      <label className="field">
        ChatGPT account
        <select
          aria-label="ChatGPT account"
          value={value.accountId}
          disabled={!!busy || testing}
          onChange={(e) => {
            setError('');
            onChange({ ...value, accountId: e.target.value });
          }}
        >
          <option value="">Choose an account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
              {a.signedIn ? '' : ' (signed out)'}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <button
          className="btn"
          disabled={!!busy || testing}
          onClick={() =>
            operation('accounts', async (signal) => {
              const result = await planCall({ action: 'accounts' }, signal);
              if (mounted.current) {
                setHelperReady(true);
                setAccounts(result.accounts);
                if (!value.accountId && result.accounts.length === 1)
                  onChange({ ...value, accountId: result.accounts[0]!.id });
              }
            })
          }
        >
          Refresh accounts
        </button>
        {!active?.signedIn && (
          <button className="btn primary" disabled={!!busy || testing} onClick={() => login()}>
            Continue with ChatGPT
          </button>
        )}
        {accounts.length > 0 && (
          <button className="btn" disabled={!!busy || testing} onClick={() => login(true)}>
            Add account
          </button>
        )}
        {active?.signedIn && !active.planEnabled && (
          <button className="btn" disabled={!!busy || testing} onClick={() => login(false, true)}>
            Enable plan usage
          </button>
        )}
        {active?.signedIn && (
          <button
            className="btn"
            disabled={!!busy || testing}
            onClick={() =>
              operation('logout', async (signal) => {
                const r = await planCall({ action: 'logout', accountId: active.id }, signal);
                if (!mounted.current) return;
                setAccounts((all) => all.map((a) => (a.id === r.account.id ? r.account : a)));
                setModels([]);
                setNotice(
                  r.warning ||
                    'Signed out. Account registration is retained for your next sign-in.',
                );
              })
            }
          >
            Sign out
          </button>
        )}
      </div>
      {busy && (
        <div className="row">
          <span role="status">
            {
              {
                accounts: 'Refreshing accounts…',
                login: 'Complete sign-in in the opened tab.',
                models: 'Refreshing available models…',
                logout: 'Signing out…',
              }[busy]
            }
          </span>
          {busy !== 'logout' && (
            <button className="btn" onClick={() => controller.current?.abort()}>
              Cancel
            </button>
          )}
        </div>
      )}
      <label className="field">
        ChatGPT model
        <select
          aria-label="ChatGPT model"
          value={value.model}
          disabled={!!busy || loadingModels || testing}
          onChange={(e) => {
            const model = models.find((model) => model.slug === e.target.value);
            if (model) onChange({ ...value, model: model.slug, ...planModelDefaults(model) });
          }}
        >
          <option value="">Refresh models to choose</option>
          {value.model && !models.some((m) => m.slug === value.model) && (
            <option value={value.model}>
              {value.model} {modelsReady ? '(unavailable)' : '(saved)'}
            </option>
          )}
          {models.map((m) => (
            <option key={m.slug} value={m.slug}>
              {m.display_name}
            </option>
          ))}
        </select>
      </label>
      {(!!selectedModel?.supportedReasoningEfforts.length || !!value.effort) && (
        <label className="field">
          Effort
          <select
            aria-label="ChatGPT effort"
            value={value.effort ?? ''}
            disabled={!!busy || loadingModels || testing || !selectedModel}
            onChange={(event) => onChange({ ...value, effort: event.target.value })}
          >
            <option value="">Default</option>
            {value.effort &&
              !selectedModel?.supportedReasoningEfforts.some(
                (level) => level.effort === value.effort,
              ) && <option value={value.effort}>{value.effort} (unavailable)</option>}
            {selectedModel?.supportedReasoningEfforts.map((level) => (
              <option key={level.effort} value={level.effort} title={level.description}>
                {level.effort[0]?.toUpperCase()}
                {level.effort.slice(1)}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        Speed
        <select
          aria-label="ChatGPT speed"
          value={value.fast ? 'fast' : 'standard'}
          disabled={!!busy || loadingModels || testing || !selectedModel}
          onChange={(event) => onChange({ ...value, fast: event.target.value === 'fast' })}
        >
          <option value="standard">Standard</option>
          <option value="fast" disabled={!selectedModel?.fastTier}>
            Fast{selectedModel && !selectedModel.fastTier ? ' (unavailable)' : ''}
          </option>
        </select>
      </label>
      {loadingModels && <p role="status">Loading available models…</p>}
      {modelIssue && (
        <p className="notice error" role="alert">
          {modelIssue}
        </p>
      )}
      <div className="row">
        <button
          className="btn"
          disabled={!!busy || loadingModels || testing || !active?.planEnabled}
          onClick={() => operation('models', (signal) => loadModels(value.accountId, signal))}
        >
          Refresh models
        </button>
        <button
          className="btn"
          disabled={
            !!busy ||
            loadingModels ||
            testing ||
            !active?.planEnabled ||
            !value.model ||
            !modelsReady ||
            !!modelIssue
          }
          onClick={test}
        >
          Test generation
        </button>
      </div>
      {!minimum && active?.planEnabled && (
        <p className="small">
          {saved ? 'Using ChatGPT plan' : 'Save to use this account for new explanations.'}
        </p>
      )}
      <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">
        Manage usage
      </a>
      <details open={!minimum}>
        <summary>Details</summary>
        {helperReady === true && <p className="small muted">ChatGPT helper connected.</p>}
        <p className="small muted">
          Generation and tests use your ChatGPT plan. API-key profiles are billed separately.
        </p>
        {value.fast && (
          <p className="small muted">
            Fast requests priority service and may use more plan allowance.
          </p>
        )}
      </details>
      <details open={helperReady === false}>
        <summary>ChatGPT helper setup</summary>
        <p className="small muted">
          From your Saul checkout, install the local helper for this extension. It stores OAuth
          credentials on this computer, outside browser storage. Node 24 or later is required.
        </p>
        <code className="code">
          node native/install.mjs --chatgpt --extension-id {chrome.runtime.id}
        </code>
        <p className="small muted">
          Then retry Continue with ChatGPT. This helper is separate from Codex tab access.
        </p>
      </details>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {!minimum && welcome && (
        <dialog
          ref={welcomeDialog}
          onCancel={() => setWelcome(false)}
          aria-label="You're using your ChatGPT plan"
          className="panel stack"
        >
          <strong>You're using your ChatGPT plan</strong>
          <p>
            Eligible Saul requests use your plan after you save this provider. Review app limits in
            ChatGPT usage settings.
          </p>
          <button
            className="btn primary"
            onClick={() => {
              void chrome.storage.local
                .set({ saul_chatgpt_welcome_seen: true })
                .then(() => setWelcome(false))
                .catch(() => setError('Could not save confirmation.'))
                .finally(() => setWelcome(false));
            }}
          >
            Got it
          </button>
        </dialog>
      )}
    </div>
  );
}
