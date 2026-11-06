import { ControlIcon } from '../surface/ControlIcon';
import { useEffect, useRef } from 'react';
import { ActionLabel } from '../surface/ActionLabel';
import { planCall } from '../models/chatgpt-plan';
import { planModelDefaults } from '../../native/plan-models.mts';
import { useMinimumMode } from './useMinimumMode';
import type { PlanSettingsState } from './usePlanSettings';

export function ChatGPTPlanSettings({
  plan,
  mode,
  visible,
  disabled,
  test,
  shared = false,
}: {
  plan: PlanSettingsState;
  mode: 'connection' | 'preset';
  visible: boolean;
  disabled: boolean;
  test: () => void;
  shared?: boolean;
}) {
  const { minimum } = useMinimumMode();
  const dialog = useRef<HTMLDialogElement>(null);
  const {
    value,
    onChange,
    active,
    accounts,
    models,
    busy,
    loadingModels,
    selectedModel,
    modelsReady,
    modelIssue,
  } = plan;
  const locked = disabled || !!busy || loadingModels;
  useEffect(() => {
    if (mode === 'connection' && visible && plan.welcome && !minimum) dialog.current?.showModal();
    else dialog.current?.close();
  }, [mode, visible, plan.welcome, minimum]);
  return (
    <div className="stack">
      {plan.error && (
        <p className="notice error" role="alert">
          {plan.error}
        </p>
      )}
      {mode === 'preset' ? (
        <>
          <label className="field">
            Model
            <select
              aria-label="ChatGPT model"
              value={value.model}
              disabled={locked}
              onChange={(event) => {
                const model = models.find((m) => m.slug === event.target.value);
                if (model) onChange({ ...value, model: model.slug, ...planModelDefaults(model) });
              }}
            >
              <option value="">Connect to choose a model</option>
              {value.model && !models.some((m) => m.slug === value.model) && (
                <option value={value.model}>
                  {value.model} ({modelsReady ? 'unavailable' : 'saved'})
                </option>
              )}
              {models.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.display_name}
                </option>
              ))}
            </select>
          </label>
          <details>
            <summary aria-label="Model options">
              <ActionLabel short="Options" full="Model options" />
            </summary>
            <div className="stack settings-disclosure">
              {(!!selectedModel?.supportedReasoningEfforts.length || !!value.effort) && (
                <label className="field">
                  Effort
                  <select
                    aria-label="ChatGPT effort"
                    value={value.effort ?? ''}
                    disabled={locked || !selectedModel}
                    onChange={(e) => onChange({ ...value, effort: e.target.value })}
                  >
                    <option value="">Default</option>
                    {value.effort &&
                      !selectedModel?.supportedReasoningEfforts.some(
                        (e) => e.effort === value.effort,
                      ) && <option value={value.effort}>{value.effort} (unavailable)</option>}
                    {selectedModel?.supportedReasoningEfforts.map((e) => (
                      <option key={e.effort} value={e.effort}>
                        {e.effort}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="field">
                Speed
                <select
                  aria-label="ChatGPT speed"
                  title="Fast requests priority service and may use more plan allowance."
                  value={value.fast ? 'fast' : 'standard'}
                  disabled={locked || !selectedModel}
                  onChange={(e) => onChange({ ...value, fast: e.target.value === 'fast' })}
                >
                  <option value="standard">Standard</option>
                  <option value="fast" disabled={!selectedModel?.fastTier}>
                    Fast{selectedModel && !selectedModel.fastTier ? ' (unavailable)' : ''}
                  </option>
                </select>
              </label>
            </div>
          </details>
          {loadingModels && <p role="status">Loading available models…</p>}
          {modelIssue && (
            <p className="notice error" role="alert">
              {modelIssue}
            </p>
          )}
          {!active?.planEnabled && (
            <p className="notice">Connect a ChatGPT account in Connections.</p>
          )}
          <details>
            <summary aria-label="Connection and tests">
              <ActionLabel short="Tests" full="Connection and tests" />
            </summary>
            <div className="row settings-disclosure">
              <button
                className="btn"
                disabled={locked || !active?.planEnabled}
                onClick={() =>
                  void plan.operation('models', (signal) =>
                    plan.loadModels(value.accountId, signal),
                  )
                }
                aria-label="Refresh models"
                title="Refresh models"
              >
                <ControlIcon symbol="refresh" />
              </button>
              <button
                className="btn"
                disabled={
                  locked || !active?.planEnabled || !value.model || !modelsReady || !!modelIssue
                }
                onClick={test}
                aria-label="Test generation"
              >
                <ActionLabel short="Test" full="Test generation" />
              </button>
            </div>
          </details>
        </>
      ) : (
        <>
          <label className="field">
            ChatGPT account
            <select
              aria-label="ChatGPT account"
              value={value.accountId}
              disabled={locked}
              onChange={(e) => onChange({ ...value, accountId: e.target.value })}
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
          {active?.planEnabled && <p className="small">Using ChatGPT plan</p>}
          <div className="row">
            {!active?.signedIn && (
              <button
                className="btn primary"
                disabled={locked}
                onClick={() => void plan.login()}
                aria-label="Continue with ChatGPT"
              >
                <ActionLabel short="Connect" full="Continue with ChatGPT" />
              </button>
            )}
            {active?.signedIn && !active.planEnabled && (
              <button
                className="btn"
                disabled={locked}
                onClick={() => void plan.login(false, true)}
                aria-label="Enable plan usage"
              >
                <ActionLabel short="Enable" full="Enable plan usage" />
              </button>
            )}
            {accounts.length > 0 && (
              <button
                className="btn"
                disabled={locked}
                onClick={() => void plan.login(true)}
                aria-label="Add account"
              >
                <ActionLabel short="Add" full="Add account" />
              </button>
            )}
            {active?.signedIn && (
              <button
                className="btn"
                disabled={locked}
                aria-label="Sign out"
                onClick={() => {
                  if (
                    shared &&
                    !window.confirm('Sign out of this ChatGPT connection in Saul and EZ?')
                  )
                    return;
                  void plan.operation('logout', async (signal) => {
                    const r = await planCall({ action: 'logout', accountId: active.id }, signal);
                    if (!plan.mounted.current) return;
                    plan.setAccounts((all) =>
                      all.map((a) => (a.id === r.account.id ? r.account : a)),
                    );
                    plan.setModels([]);
                    plan.setNotice(
                      r.warning ||
                        'Signed out. Account registration is retained for your next sign-in.',
                    );
                  });
                }}
              >
                <ActionLabel short={shared ? 'Sign out' : 'Disconnect'} full="Sign out" />
              </button>
            )}
            <a
              href="https://chatgpt.com/settings/usage"
              target="_blank"
              rel="noreferrer"
              aria-label="Manage usage"
            >
              <ActionLabel short="Usage" full="Manage usage" />
            </a>
            <button
              className="btn"
              disabled={locked || !active?.planEnabled}
              aria-label="Refresh models"
              title="Refresh models"
              onClick={() =>
                void plan.operation('models', (signal) => plan.loadModels(value.accountId, signal))
              }
            >
              <ControlIcon symbol="refresh" />
            </button>
          </div>
          <details>
            <summary aria-label="Manage accounts">
              <ActionLabel short="Accounts" full="Manage accounts" />
            </summary>
            <button
              className="btn"
              disabled={locked}
              aria-label="Refresh accounts"
              title="Refresh accounts"
              onClick={() =>
                void plan.operation('accounts', async (signal) => {
                  const result = await planCall({ action: 'accounts' }, signal);
                  if (plan.mounted.current) {
                    plan.setAccounts(result.accounts);
                    plan.setHelperReady(true);
                  }
                })
              }
            >
              <ControlIcon symbol="refresh" />
            </button>
          </details>
          <p className="small muted standard-only">
            ChatGPT requests use plan allowance. API connections are billed separately.
          </p>
          {plan.welcome && !minimum && (
            <dialog
              ref={dialog}
              aria-label="You're using your ChatGPT plan"
              className="panel stack"
              onCancel={() => plan.setWelcome(false)}
            >
              <strong>You're using your ChatGPT plan</strong>
              <p>Eligible Saul requests use your plan after you save this connection.</p>
              <button
                className="btn primary"
                aria-label="Got it"
                onClick={() =>
                  void chrome.storage.local
                    .set({ saul_chatgpt_welcome_seen: true })
                    .then(() => plan.setWelcome(false))
                    .catch(() => plan.setError('Could not save confirmation.'))
                }
              >
                <ActionLabel short="Done" full="Got it" />
              </button>
            </dialog>
          )}
        </>
      )}
    </div>
  );
}
