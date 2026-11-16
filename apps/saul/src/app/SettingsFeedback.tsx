import type { Ref } from 'react';
import { ActionLabel } from '../surface/ActionLabel';
import type { useSettingsDraft } from './useSettingsDraft';
import type { useProviderTest } from './useProviderTest';
import type { PlanSettingsState } from './usePlanSettings';
import type { SettingsSection } from './settings-sections';

type SaveState = Pick<
  ReturnType<typeof useSettingsDraft>,
  'dirty' | 'saved' | 'saving' | 'blocked' | 'recoveryNotice' | 'save' | 'reviewLatest' | 'reload'
>;
type ProviderTestState = Pick<
  ReturnType<typeof useProviderTest>,
  'testing' | 'notice' | 'stop' | 'clear'
>;

/** Displays shared operation state; the coordinator owns lifetimes and focus recovery. */
export function SettingsFeedback({
  draft,
  providerTest,
  plan,
  error,
  planBusy,
  speechBusy,
  actionBuilding,
  section,
  onSectionChange,
  saveButton,
  reviewButton,
}: {
  draft: SaveState;
  providerTest: ProviderTestState;
  plan: Pick<PlanSettingsState, 'busy' | 'notice' | 'controller'>;
  error: string;
  planBusy: boolean;
  speechBusy: boolean;
  actionBuilding: boolean;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  saveButton: Ref<HTMLButtonElement>;
  reviewButton: Ref<HTMLButtonElement>;
}) {
  const { dirty, saved, saving, save } = draft;
  const { testing, notice } = providerTest;
  return (
    <div
      className="settings-save"
      hidden={
        !dirty &&
        !saved &&
        !error &&
        !notice &&
        !draft.recoveryNotice &&
        !testing &&
        !planBusy &&
        !speechBusy &&
        !actionBuilding &&
        (section === 'preferences' || section === 'connections')
      }
    >
      {testing && (
        <div className="row">
          <span role="status" className="small muted">
            Testing provider…
          </span>
          <button
            className="btn"
            onClick={providerTest.stop}
            aria-label="Stop test"
            title="Stop test"
          >
            <ActionLabel short="Stop" full="Stop test" />
          </button>
        </div>
      )}
      {actionBuilding && section !== 'calls' && (
        <div className="row">
          <span role="status">Building call…</span>
          <button className="btn" onClick={() => onSectionChange('calls')}>
            Calls
          </button>
        </div>
      )}
      {planBusy && (
        <div className="row">
          <span role="status">
            {plan.busy
              ? {
                  accounts: 'Refreshing accounts…',
                  login: 'Complete sign-in in the opened tab.',
                  logout: 'Signing out…',
                  models: 'Refreshing available models…',
                }[plan.busy]
              : 'Account operation in progress.'}
          </span>
          <button className="btn" onClick={() => onSectionChange('connections')}>
            Connections
          </button>
        </div>
      )}
      {plan.busy && plan.busy !== 'logout' && (
        <button className="btn" onClick={() => plan.controller.current?.abort()}>
          Cancel
        </button>
      )}
      {plan.notice && (
        <p className="notice" role="status">
          {plan.notice}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {draft.recoveryNotice && (
        <p className="notice" role="status">
          {draft.recoveryNotice}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <div className="row between">
        <span className="small muted" role="status">
          {dirty ? 'Unsaved changes' : saved ? 'Saved' : 'Configuration'}
        </span>
        <div className="row">
          {draft.blocked && (
            <button
              ref={reviewButton}
              className="btn primary"
              disabled={testing || saving || planBusy || speechBusy}
              onClick={() => {
                providerTest.clear();
                void draft.reviewLatest();
              }}
            >
              Review latest
            </button>
          )}
          {draft.blocked && (
            <button
              className="btn"
              disabled={testing || saving || planBusy || speechBusy}
              onClick={() => {
                providerTest.clear();
                void draft.reload();
              }}
              aria-label="Reload saved settings"
              title="Reload saved settings"
            >
              <ActionLabel short="Reload" full="Reload saved settings" symbol="reload" />
            </button>
          )}
          <button
            ref={saveButton}
            className="btn primary"
            disabled={testing || saving || planBusy || speechBusy || draft.blocked}
            onClick={save}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
