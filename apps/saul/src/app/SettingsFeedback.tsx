import type { Ref } from 'react';
import { ActionLabel } from '../surface/ActionLabel';
import type { useSettingsEditor } from './useSettingsEditor';
import type { useProviderTest } from './useProviderTest';
import type { SettingsSection } from './settings-sections';

type SaveState = Pick<
  ReturnType<typeof useSettingsEditor>,
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
  error,
  speechBusy,
  actionBuilding,
  section,
  onSectionChange,
  saveButton,
  reviewButton,
}: {
  draft: SaveState;
  providerTest: ProviderTestState;
  error: string;
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
        !draft.blocked &&
        !error &&
        !notice &&
        !draft.recoveryNotice &&
        !testing &&
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
              disabled={testing || saving || speechBusy}
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
              disabled={testing || saving || speechBusy}
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
            disabled={testing || saving || speechBusy || draft.blocked}
            onClick={save}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
