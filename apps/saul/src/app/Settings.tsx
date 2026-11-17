import { PresetSettings } from './PresetSettings';
import { SettingsShortcuts } from './SettingsShortcuts';
import { ReadingSettings } from './ReadingSettings';
import { SettingsFeedback } from './SettingsFeedback';
import { ConnectionSettings, ConnectionPresetWarnings } from './ConnectionSettings';
import { NativeBridge } from './NativeBridge';
import { StandaloneConnectionSettings } from './StandaloneConnectionSettings';
import { SharedCredentialSettings } from './SharedCredentialSettings';
import { usePlanSettings } from './usePlanSettings';
import { ActionLabel } from '../surface/ActionLabel';
import { useEffect, useRef, useState } from 'react';
import { useSettingsEditor } from './useSettingsEditor';
import { useProviderTest } from './useProviderTest';
import { configurationFor } from '../configuration/definition';
import { CallSettings } from './CallSettings';
import type { SettingsSection } from './settings-sections';
import { SettingsRecovery } from './SettingsRecovery';
import type { SettingsPreferences } from '../settings/draft';

export function Settings({
  onDirty,
  section = 'overview',
  onSectionChange = () => {},
}: {
  onDirty?: (dirty: boolean) => void;
  section?: SettingsSection;
  onSectionChange?: (section: SettingsSection) => void;
}) {
  const [connectionDirty, setConnectionDirty] = useState(false);
  const draft = useSettingsEditor((value) => onDirty?.(value || connectionDirty));
  const { configuration: settings, inspection, loaded, dirty, saved, saving, save } = draft;
  const reviewButton = useRef<HTMLButtonElement>(null),
    saveButton = useRef<HTMLButtonElement>(null);
  const wasReviewing = useRef(false);
  useEffect(() => {
    if (wasReviewing.current && !draft.review)
      (draft.blocked ? reviewButton : saveButton).current?.focus();
    wasReviewing.current = !!draft.review;
  }, [draft.review, draft.blocked]);
  const providerTest = useProviderTest();
  const { testing, notice } = providerTest;
  const [presetSearch, setPresetSearch] = useState('');
  const [planBusy, setPlanBusy] = useState(false);
  const [speechBusy, setSpeechBusy] = useState(false);
  const [actionBuilding, setActionBuilding] = useState(false);
  const configuration = configurationFor(settings);
  const selectedPreset = draft.selectedPreset;
  const planValue = draft.planEditor[section === 'models' ? 'preset' : 'connection'];
  const plan = usePlanSettings(
    planValue,
    (value) => {
      if (value.accountId !== planValue.accountId)
        draft.edit({ type: 'plan-account', accountId: value.accountId });
      if (
        selectedPreset?.provider === 'chatgpt-plan' &&
        (value.model !== planValue.model ||
          value.effort !== planValue.effort ||
          value.fast !== planValue.fast)
      )
        draft.edit({
          type: 'preset',
          patch: { model: value.model, effort: value.effort, fast: value.fast },
        });
    },
    setPlanBusy,
    loaded && settings.sharedCredentials === undefined,
    settings.sharedCredentials,
  );
  const error = draft.error || providerTest.error;
  function update(patch: Partial<SettingsPreferences>) {
    draft.edit({ type: 'settings', patch });
    providerTest.clear();
  }
  const test = (mode: 'endpoint' | 'generation') =>
    providerTest.test(mode, settings, selectedPreset?.id);
  const locked = testing || planBusy || speechBusy;
  if (!loaded)
    return error ? (
      <div className="stack settings-layout">
        <p role="alert" className="notice error">
          {error}
        </p>
        {draft.canResetInvalidSettings && (
          <button
            type="button"
            className="btn"
            aria-label="Back up and reset settings"
            title="Back up and reset settings"
            disabled={draft.resettingInvalidSettings || draft.blocked}
            onClick={draft.resetInvalidSettings}
          >
            {draft.resettingInvalidSettings ? (
              'Resetting…'
            ) : (
              <ActionLabel short="Reset" full="Back up and reset settings" />
            )}
          </button>
        )}
        <button
          className="btn"
          disabled={saving}
          onClick={draft.reload}
          aria-label="Reload saved settings"
          title="Reload saved settings"
        >
          <ActionLabel short="Reload" full="Reload saved settings" symbol="reload" />
        </button>
      </div>
    ) : (
      <p role="status">Loading settings…</p>
    );
  return (
    <>
      {draft.review && (
        <SettingsRecovery
          review={draft.review}
          error={draft.error}
          apply={draft.applyReview}
          cancel={draft.cancelReview}
        />
      )}
      <fieldset
        className="stack settings-layout settings-fields"
        disabled={saving || !!draft.review}
        hidden={!!draft.review}
      >
        {loaded &&
          settings.sharedCredentials === 'saul' &&
          settings.connections.map((connection) => (
            <ConnectionPresetWarnings
              key={connection.key}
              connection={connection}
              omitPresetId={section === 'models' ? selectedPreset?.id : undefined}
              presets={configuration.presets}
              edit={(id) => {
                draft.edit({ type: 'select-preset', id });
                onSectionChange('models');
              }}
            />
          ))}
        {settings.sharedCredentials === undefined ? (
          <StandaloneConnectionSettings
            settings={settings}
            edit={draft.edit}
            plan={plan}
            disabled={locked}
            visible={section === 'connections'}
          />
        ) : (
          <ConnectionSettings
            settings={settings}
            disabled={locked || draft.blocked}
            visible={section === 'connections'}
            dirty={dirty}
            commit={draft.commitConnections}
            onDirty={(value) => {
              setConnectionDirty(value);
              onDirty?.(value || dirty);
            }}
            integrations={() => onSectionChange('preferences')}
          />
        )}
        <PresetSettings
          presets={configuration.presets}
          selectedPresetId={draft.selectedPresetId}
          selectedPreset={selectedPreset}
          settings={{
            connections: settings.connections,
            profiles: settings.profiles,
            connectionProfiles: settings.connectionProfiles,
            sharedCredentials: settings.sharedCredentials,
          }}
          remote={inspection.remote}
          plan={plan}
          visible={section === 'models'}
          saved={!dirty}
          locked={locked}
          testing={testing}
          planBusy={planBusy}
          edit={draft.edit}
          search={{ value: presetSearch, change: setPresetSearch }}
          clearTest={providerTest.clear}
          test={test}
          onSpeechBusy={setSpeechBusy}
          openConnections={() => onSectionChange('connections')}
        />
        <section hidden={section !== 'calls'} className="settings-section" aria-label="Calls">
          <h2 className="view-title">Calls</h2>
          <CallSettings
            presets={configuration.presets}
            summaryPresetId={settings.summaryPresetId ?? ''}
            onSummaryPresetChange={(id) => update({ summaryPresetId: id || undefined })}
            settingsDirty={dirty}
            onBuildingChange={setActionBuilding}
          >
            <label className="field">
              PDF processing
              <select
                aria-label="PDF processing"
                value={settings.summaryPdfProcessing ?? 'attachment'}
                onChange={(event) =>
                  update({ summaryPdfProcessing: event.target.value as 'attachment' | 'local' })
                }
              >
                <option value="attachment">PDF URL attachment (server)</option>
                <option value="local">Local parsing · send text</option>
              </select>
            </label>
            <details className="standard-only">
              <summary>About PDF processing</summary>
              <p className="small muted">
                PDF URL attachment requires a ChatGPT plan preset and a link OpenAI can open without
                your browser sign-in. Local parsing sends extracted text only. This setting applies
                to new calls and Run again; Retry keeps the saved method.
              </p>
            </details>
          </CallSettings>
        </section>
        <ReadingSettings
          section={section}
          configuration={configuration}
          recipeId={draft.selectedRecipeId}
          responseLanguage={settings.responseLanguage}
          contextPolicy={settings.contextPolicy}
          onEdit={draft.edit}
          update={update}
          onSectionChange={onSectionChange}
        />
        <details hidden={section !== 'preferences'} className="panel">
          <summary>Integrations</summary>
          <SharedCredentialSettings
            owner={settings.sharedCredentials}
            disabled={locked || dirty}
            visible={section === 'preferences'}
            change={draft.setCredentialOwner}
          />
          <p className="small">
            The signed credential helper manages shared sign-in and keys. Install or update it if
            connections are unavailable.
          </p>
          <NativeBridge />
          {settings.sharedCredentials === undefined && (
            <details>
              <summary>ChatGPT helper setup</summary>
              <code className="code">
                pnpm native:install --chatgpt --extension-id {chrome.runtime.id}
              </code>
            </details>
          )}
        </details>
        <SettingsShortcuts visible={section === 'preferences'} />
        <SettingsFeedback
          draft={{
            dirty,
            saved,
            saving,
            save,
            blocked: draft.blocked,
            recoveryNotice: draft.recoveryNotice,
            reviewLatest: draft.reviewLatest,
            reload: draft.reload,
          }}
          providerTest={{ testing, notice, stop: providerTest.stop, clear: providerTest.clear }}
          plan={{ busy: plan.busy, notice: plan.notice, cancel: plan.cancel }}
          error={error}
          planBusy={planBusy}
          speechBusy={speechBusy}
          actionBuilding={actionBuilding}
          section={section}
          onSectionChange={onSectionChange}
          saveButton={saveButton}
          reviewButton={reviewButton}
        />
      </fieldset>
    </>
  );
}
