import { readCredentialRoute } from '../src/providers/credential-route';
import { initAnnotations } from '../src/annotations/background';
import { createCustomActionStore } from '../src/custom-actions/store';
import { legacySummaryPreset } from '../src/calls/choice-migration';
import { captureTab, verifyCaptureTab } from '../src/calls/capture/capture';
import { validateCallControl, validateCallLaunch } from '../src/calls/batch-messages';
import {
  CALL_CONTROL,
  CALL_EDIT,
  CALL_EDITOR_STORAGE,
  CALL_LAUNCH,
  DIGEST_CAPTURE,
  validateCallEditorBridge,
  validateDigestCapture,
  type CallEditorStorageReplies,
  type CallLaunchReply,
  type DigestCaptureHandlers,
} from '../src/calls/messages';
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
import { prepareWritePreset } from '../src/configuration/resolver';
import { sharedPresets } from '../src/configuration/shared';
import { CONNECTION_TARGET } from '../src/connections/messages';
import { createConnectionService } from '../src/connections/service';
import { ConnectionSetupNotAdmitted } from '../src/connections/setup';
import { createConfigurationStore } from '../src/configuration/store';
import {
  chromeConfigurationStorage,
  initStorageSecurity,
} from '../src/configuration/chrome-storage';
import { runnerRequest, type RunnerDbCall } from '../src/platform/chrome/runner';
import { initReadingHost } from '../src/reading/background';
import { initNativeBridge } from '../src/native/bridge';
import { workspaceCall } from '../src/native/workspace';
import { offscreenSender, workspaceSender } from '../src/platform/chrome/sender';

const db: RunnerDbCall = (message) => runnerRequest({ operation: 'db', message });
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
async function handleCallLaunch(message: unknown): Promise<CallLaunchReply> {
  validateCallLaunch(message);
  return launchCall(message);
}
const captureHandlers: DigestCaptureHandlers = { capture: captureTab, verify: verifyCaptureTab };

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
        CALL_CONTROL,
        CALL_LAUNCH,
        CALL_EDIT,
        CALL_EDITOR_STORAGE,
        DIGEST_CAPTURE,
        'saul-settings',
        CONNECTION_TARGET,
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
      if (request.target === CALL_EDITOR_STORAGE) {
        if (!offscreenSender(sender)) throw new Error('Runner only');
        const message: unknown = request.message;
        validateCallEditorBridge(message);
        switch (message?.action) {
          case 'read-choices':
            return actionStore.readChoices() satisfies Promise<
              CallEditorStorageReplies['read-choices']
            >;
          case 'save-choices':
            return actionStore.saveChoices(message.source, message.choices) satisfies Promise<
              CallEditorStorageReplies['save-choices']
            >;
          case 'read-draft':
            return actionStore.readDraft() satisfies Promise<
              CallEditorStorageReplies['read-draft']
            >;
          case 'save-draft':
            return actionStore.saveDraft(message.draft) satisfies Promise<
              CallEditorStorageReplies['save-draft']
            >;
          case 'prepare-preset':
            return prepareWritePreset(
              await currentSettings(),
              message.presetId,
            ) satisfies CallEditorStorageReplies['prepare-preset'];
          default:
            throw new Error('Invalid Call storage request.');
        }
      }
      if (request.target === DIGEST_CAPTURE) {
        if (!offscreenSender(sender)) throw new Error('Runner only');
        const capture: unknown = request;
        validateDigestCapture(capture);
        return capture.verifyOnly
          ? captureHandlers.verify(capture.item)
          : captureHandlers.capture(capture.item);
      }
      if (!workspaceSender(sender)) throw new Error('Extension workspace only');
      if (request.target === 'saul-settings') return settings(request.message);
      if (request.target === CONNECTION_TARGET) return connections.request(request.message);
      if (request.target === CALL_EDIT) {
        validateCallEditRequest(request.message);
        return runnerRequest({ operation: 'action', message: request.message });
      }
      if (request.target === CALL_LAUNCH) {
        return handleCallLaunch(request.message);
      }
      if (request.target === CALL_CONTROL) {
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
