import { PresetSettings } from './PresetSettings';
import { SettingsShortcuts } from './SettingsShortcuts';
import { ReadingSettings } from './ReadingSettings';
import { SettingsFeedback } from './SettingsFeedback';
import { ConnectionSettings, ConnectionPresetWarnings } from './ConnectionSettings';
import { NativeBridge } from './NativeBridge';
import { StandaloneConnectionSettings } from './StandaloneConnectionSettings';
import { SharedCredentialSettings } from './SharedCredentialSettings';
import { ActionLabel } from '../../ui/ActionLabel';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettingsEditor } from './useSettingsEditor';
import { useProviderTest } from './useProviderTest';
import { configurationFor } from '../../configuration/definition';
import { CallSettings } from '../../calls/ui/CallSettings';
import type { SettingsSection } from './settings-sections';
import { SettingsRecovery } from './SettingsRecovery';
import type { SettingsPreferences } from '../draft';

export function Settings({
  onDirty,
  initialPresetId,
  section = 'overview',
  onSectionChange = () => {},
}: {
  initialPresetId?: string;
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
  const [focusConnection, setFocusConnection] = useState<string>();
  const connectionFocused = useCallback(() => setFocusConnection(undefined), []);
  const [speechBusy, setSpeechBusy] = useState(false);
  const [actionBuilding, setActionBuilding] = useState(false);
  const configuration = configurationFor(settings);
  const selectedPreset = draft.selectedPreset;
  const appliedPresetLink = useRef(false);
  const selectPreset = draft.edit;
  const linkedPreset = configuration.presets.find((preset) => preset.id === initialPresetId)?.id;
  useEffect(() => {
    if (!loaded || appliedPresetLink.current || !linkedPreset) return;
    appliedPresetLink.current = true;
    selectPreset({ type: 'select-preset', id: linkedPreset });
  }, [linkedPreset, loaded, selectPreset]);
  const error = draft.error || providerTest.error;
  function update(patch: Partial<SettingsPreferences>) {
    draft.edit({ type: 'settings', patch });
    providerTest.clear();
  }
  const test = (mode: 'endpoint' | 'generation') =>
    providerTest.test(mode, settings, selectedPreset?.id);
  const locked = testing || speechBusy;
  const connectionEdited = (value: boolean) => {
    setConnectionDirty(value);
    onDirty?.(value || dirty);
  };
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
        {settings.sharedCredentials !== 'saul' ? (
          <StandaloneConnectionSettings
            settings={settings}
            edit={draft.edit}
            disabled={locked}
            managementDisabled={locked || dirty || draft.blocked}
            manageConnection={draft.manageConnection}
            onDirty={connectionEdited}
            visible={section === 'connections'}
            integrations={() => onSectionChange('preferences')}
          />
        ) : (
          <ConnectionSettings
            settings={settings}
            disabled={locked || draft.blocked}
            visible={section === 'connections'}
            dirty={dirty}
            commit={draft.finishConnection}
            manageConnection={draft.manageConnection}
            focusConnection={focusConnection}
            onConnectionFocused={connectionFocused}
            onDirty={connectionEdited}
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
          visible={section === 'models'}
          saved={!dirty}
          locked={locked}
          testing={testing}
          edit={draft.edit}
          search={{ value: presetSearch, change: setPresetSearch }}
          clearTest={providerTest.clear}
          test={test}
          onSpeechBusy={setSpeechBusy}
          openConnections={(connectionKey) => {
            setFocusConnection(settings.sharedCredentials === 'saul' ? connectionKey : undefined);
            onSectionChange('connections');
          }}
        />
        <section hidden={section !== 'calls'} className="settings-section" aria-label="Calls">
          <h2 className="view-title">Calls</h2>
          <CallSettings
            presets={configuration.presets}
            visible={section === 'calls'}
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
          <section className="panel stack" aria-labelledby="provider-credentials">
            <strong id="provider-credentials">Provider credentials</strong>
            <SharedCredentialSettings
              owner={settings.sharedCredentials}
              disabled={locked || dirty}
              visible={section === 'preferences'}
              change={draft.setCredentialOwner}
            />
          </section>
          <NativeBridge />
          <details>
            <summary>History and configuration helper setup</summary>
            <code className="code">
              pnpm native:install --chatgpt --extension-id {chrome.runtime.id}
            </code>
          </details>
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
          error={error}
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
