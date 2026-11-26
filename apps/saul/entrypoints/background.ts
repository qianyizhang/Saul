import { readCredentialRoute } from '../src/providers/credential-route';
import { initAnnotations } from '../src/annotations/background';
import { createCustomActionStore } from '../src/custom-actions/store';
import { legacySummaryPreset } from '../src/calls/choice-migration';
import { captureTab, verifyCaptureTab } from '../src/calls/capture/capture';
import { validateCallControl, validateCallLaunch } from '../src/calls/batch-messages';
import { createCallAdmission, retryCallCredential } from '../src/calls/admission';
import { initSummaryActions } from '../src/calls/summary-actions';
import { pendingPanelCallKey, summaryPanelKey } from '../src/calls/panel-route';
import { initDeepDives } from '../src/deep-dives/background';
import { initStorageBridge } from '../src/native/storage-bridge';
import { initCredentialBridge } from '../src/native/credentials';
import { nativeCredentialAccess } from '../src/configuration/credentials';
import { initSpeechBridge } from '../src/speech/bridge';
import { initActionBridge } from '../src/custom-actions/bridge';
import { validateCallEditRequest } from '../src/calls/contract';
import type { CallEditorBridgeRequest } from '../src/calls/editor-client';
import { prepareWritePreset } from '../src/configuration/resolver';
import { sharedPresets } from '../src/configuration/shared';
import { createConnectionService } from '../src/connections/service';
import { ConnectionSetupNotAdmitted } from '../src/connections/setup';
import { createConfigurationStore } from '../src/configuration/store';
import {
  chromeConfigurationStorage,
  initStorageSecurity,
} from '../src/configuration/chrome-storage';
import { runnerRequest } from '../src/platform/chrome/runner';
import { initReadingHost } from '../src/reading/background';
import { initNativeBridge } from '../src/native/bridge';
import { workspaceCall } from '../src/native/workspace';
import { offscreenSender, workspaceSender } from '../src/platform/chrome/sender';
import type { DbCall, DbRequest } from '../shared/protocol/history-types.ts';

const db: DbCall = (message) => runnerRequest({ operation: 'db', message: message as DbRequest });
const actionStore = createCustomActionStore(async () =>
  legacySummaryPreset(await currentSettings()),
);
const settingsOwner = createConfigurationStore(
  chromeConfigurationStorage,
  sharedPresets,
  nativeCredentialAccess,
  actionStore.migrationComplete,
);
const connections = createConnectionService(settingsOwner);
const launchCall = createCallAdmission({
  readSettings: () => settingsOwner({ action: 'read' }),
  readChoices: actionStore.readChoices,
  saveChoices: actionStore.saveChoices,
  lookup: (id, snapshot) =>
    runnerRequest({ operation: 'digest', message: { action: 'resolve', id }, snapshot }),
  start: (snapshot, credential, regenerate) =>
    runnerRequest({
      operation: 'digest',
      message: { action: 'start', id: snapshot.id, regenerate },
      snapshot,
      credential,
    }),
  readBatch: (id) => db({ type: 'DB_DIGEST_GET', payload: { id } }),
});
async function currentSettings() {
  const result = await settingsOwner({ action: 'read' });
  if (result.state !== 'ready') throw new Error(result.error);
  return result.settings;
}
export default defineBackground(() => {
  initSummaryActions();
  initDeepDives();
  initAnnotations(currentSettings, actionStore.readLibrary);
  const settings = settingsOwner;
  initStorageSecurity();
  initNativeBridge();
  initStorageBridge();
  initCredentialBridge();
  connections.registerReviewPort();
  initSpeechBridge(currentSettings);
  initActionBridge();
  initReadingHost(db, currentSettings);
  chrome.windows.onRemoved.addListener((windowId) => {
    void chrome.storage.session.remove([summaryPanelKey(windowId), pendingPanelCallKey(windowId)]);
  });
  chrome.runtime.onMessage.addListener((request, sender, reply) => {
    if (
      ![
        'saul-digest',
        'saul-call-launch',
        'saul-action',
        'saul-call-editor',
        'saul-digest-capture',
        'saul-settings',
        'saul-connection',
        'saul-credential-mode',
      ].includes(request?.target) &&
      request?.type !== 'WORKSPACE_TABS'
    )
      return false;
    (async () => {
      if (request.target === 'saul-credential-mode') {
        if (!offscreenSender(sender)) throw new Error('Runner only');
        const route = await readCredentialRoute();
        return { mode: route === 'local' ? 'standalone' : route };
      }
      if (request.target === 'saul-call-editor') {
        if (!offscreenSender(sender)) throw new Error('Runner only');
        const message: CallEditorBridgeRequest = request.message;
        switch (message?.action) {
          case 'read-choices':
            return actionStore.readChoices();
          case 'save-choices':
            return actionStore.saveChoices(message.source, message.choices);
          case 'read-draft':
            return actionStore.readDraft();
          case 'save-draft':
            return actionStore.saveDraft(message.draft);
          case 'prepare-preset':
            return prepareWritePreset(await currentSettings(), message.presetId);
          default:
            throw new Error('Invalid Call storage request.');
        }
      }
      if (request.target === 'saul-digest-capture') {
        if (!offscreenSender(sender)) throw new Error('Runner only');
        return request.verifyOnly ? verifyCaptureTab(request.item) : captureTab(request.item);
      }
      if (!workspaceSender(sender)) throw new Error('Extension workspace only');
      if (request.target === 'saul-settings') return settings(request.message);
      if (request.target === 'saul-connection') return connections.request(request.message);
      if (request.target === 'saul-action') {
        validateCallEditRequest(request.message);
        return runnerRequest({ operation: 'action', message: request.message });
      }
      if (request.target === 'saul-call-launch') {
        validateCallLaunch(request.message);
        return launchCall(request.message);
      }
      if (request.target === 'saul-digest') {
        validateCallControl(request.message);
        const message = request.message;
        const credential =
          message.action === 'retry'
            ? await retryCallCredential(
                await db({ type: 'DB_DIGEST_GET', payload: { id: message.id } }),
                currentSettings,
              )
            : undefined;
        return runnerRequest({ operation: 'digest', message, credential });
      }
      if (request.type === 'WORKSPACE_TABS') return workspaceCall(request);
    })().then(
      (result) => reply({ success: true, result }),
      (error) =>
        reply({
          success: false,
          error: error instanceof Error ? error.message : String(error),
          ...(error instanceof ConnectionSetupNotAdmitted && { setupNotAdmitted: true }),
        }),
    );
    return true;
  });
});
