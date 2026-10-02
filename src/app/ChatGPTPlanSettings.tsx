import { useEffect, useRef, useState } from 'react';
import { planCall } from '../models/chatgpt-plan';
import type { PlanAccount, PlanModel } from '../../native/plan-protocol.mjs';
import type { UserSettings } from '../types';

export function ChatGPTPlanSettings({
  value,
  onChange,
  test,
  testing,
  saved,
}: {
  value: NonNullable<UserSettings['chatgptPlan']>;
  onChange: (value: NonNullable<UserSettings['chatgptPlan']>) => void;
  test: () => void;
  testing: boolean;
  saved: boolean;
}) {
  const [accounts, setAccounts] = useState<PlanAccount[]>([]);
  const [models, setModels] = useState<PlanModel[]>([]);
  const [busy, setBusy] = useState<'accounts' | 'login' | 'logout' | 'models' | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [welcome, setWelcome] = useState(false);
  const mounted = useRef(true),
    controller = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const welcomeDialog = useRef<HTMLDialogElement>(null);
  const active = accounts.find((a) => a.id === value.accountId);
  useEffect(() => {
    mounted.current = true;
    void planCall({ action: 'accounts' })
      .then((r) => {
        if (mounted.current) setAccounts(r.accounts);
      })
      .catch((e) => {
        if (mounted.current) setError(e.message);
      });
    return () => {
      mounted.current = false;
      revision.current++;
    };
  }, []);
  useEffect(() => {
    if (!accounts.some((account) => account.planEnabled)) return;
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
  }, [accounts]);
  useEffect(() => {
    if (welcome) welcomeDialog.current?.showModal();
  }, [welcome]);
  // Model catalog belongs to one account; never carry choices across accounts.
  useEffect(() => {
    setModels([]);
    revision.current++;
  }, [value.accountId]);
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
  async function loadModels(accountId: string, signal: AbortSignal, preferred = '') {
    const stamp = ++revision.current;
    const result = await planCall({ action: 'models', accountId }, signal);
    if (!mounted.current || revision.current !== stamp) return;
    const list = result.models;
    setModels(list);
    onChange({
      accountId,
      model: list.some((m) => m.slug === preferred) ? preferred : list[0]?.slug || '',
    });
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
      onChange({ accountId: account.id, model: '' });
      if (account.planEnabled) {
        setNotice('Signed in. Refresh models, choose a model, and save Settings to use your plan.');
      } else
        setNotice('Signed in, but ChatGPT plan permission is disabled. Enable plan usage below.');
    });
  return (
    <div className="stack">
      <p className="small muted">
        Use eligible requests from your ChatGPT plan. Plan and app limits apply. API-key profiles
        are billed separately.
      </p>
      <label className="field">
        ChatGPT account
        <select
          aria-label="ChatGPT account"
          value={value.accountId}
          disabled={!!busy || testing}
          onChange={(e) => {
            setError('');
            onChange({ accountId: e.target.value, model: '' });
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
              if (mounted.current) setAccounts(result.accounts);
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
            Add account or workspace
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
              Stop
            </button>
          )}
        </div>
      )}
      <label className="field">
        ChatGPT model
        <select
          aria-label="ChatGPT model"
          value={value.model}
          disabled={!!busy || testing}
          onChange={(e) => onChange({ ...value, model: e.target.value })}
        >
          <option value="">Refresh models to choose</option>
          {value.model && !models.some((m) => m.slug === value.model) && (
            <option value={value.model}>{value.model} (saved)</option>
          )}
          {models.map((m) => (
            <option key={m.slug} value={m.slug}>
              {m.display_name}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <button
          className="btn"
          disabled={!!busy || testing || !active?.planEnabled}
          onClick={() =>
            operation('models', (signal) => loadModels(value.accountId, signal, value.model))
          }
        >
          Refresh models
        </button>
        <button
          className="btn"
          disabled={!!busy || testing || !active?.planEnabled || !value.model}
          onClick={test}
        >
          Test generation
        </button>
      </div>
      {active?.planEnabled && (
        <p className="small">
          {saved
            ? 'Using ChatGPT plan'
            : 'Save Settings to use your ChatGPT plan for new explanations.'}
        </p>
      )}
      <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">
        Manage usage
      </a>
      <p className="small muted">
        Generation tests use your plan quota. Model availability and usage limits depend on your
        account.
      </p>
      <details>
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
      {welcome && (
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
