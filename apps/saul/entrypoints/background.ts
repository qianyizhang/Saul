import { readCredentialRoute } from '../src/providers/credential-route';
import { initAnnotations } from '../src/annotations/background';
import { callStore } from '../src/calls/store';
import { captureTab, verifyCaptureTab } from '../src/calls/capture/capture';
import { validateDigest } from '../src/calls/batch-messages';
import { createCallAdmission } from '../src/calls/admission';
import { initSummaryActions } from '../src/calls/summary-actions';
import { initStorageBridge } from '../src/native/storage-bridge';
import { initCredentialBridge } from '../src/native/credentials';
import { nativeCredentialAccess } from '../src/configuration/credentials';
import { initSpeechBridge } from '../src/speech/bridge';
import { initActionBridge } from '../src/native/actions';
import { validateCallEditRequest } from '../src/calls/contract';
import type { CallEditorBridgeRequest } from '../src/calls/editor-client';
import { prepareCallModel } from '../src/calls/configuration';
import { sharedPresets } from '../src/configuration/shared';
import { createConfigurationStore, SETTINGS_STORAGE_KEY } from '../src/configuration/store';
import {
  chromeConfigurationStorage,
  initStorageSecurity,
} from '../src/configuration/chrome-storage';
import {
  getErrorNotificationsMuted,
  setErrorNotificationsMuted,
  NOTIFICATION_STORAGE_KEY,
} from '../src/storage/notifications';
import {
  getMinimumMode,
  minimumModeFromStorage,
  MINIMUM_MODE_STORAGE_KEY,
} from '../src/storage/presentation';
import { runnerRequest } from '../src/platform/chrome/runner';
import { configurationFor } from '../src/configuration/definition';
import { createReadingAdmission, type ReadingAdmission } from '../src/reading/admission';
import { initNativeBridge } from '../src/native/bridge';
import { workspaceCall } from '../src/native/workspace';
import { sourcePage, workspaceSender } from '../src/platform/chrome/sender';
import {
  validateReading,
  id,
  type ReadingRequest,
  type ReadingResult,
} from '../src/reading/contract';
import { validateWorkspace } from '../src/contracts/workspace';
import type { DbCall, DbRequest, Passage } from '../shared/protocol/history-types.ts';

const db: DbCall = (message) => runnerRequest({ operation: 'db', message: message as DbRequest });
const settingsOwner = createConfigurationStore(
  chromeConfigurationStorage,
  sharedPresets,
  nativeCredentialAccess,
);
const admitCall = createCallAdmission({
  readSettings: () => settingsOwner({ action: 'read' }),
  readChoices: callStore.readChoices,
  readBatch: (id) => db({ type: 'DB_DIGEST_GET', payload: { id } }),
});
async function currentSettings() {
  const result = await settingsOwner({ action: 'read' });
  if (result.state !== 'ready') throw new Error(result.error);
  return result.settings;
}
async function owned(selectionId: string, url: string): Promise<Passage> {
  const p = await db({ type: 'DB_PASSAGE', payload: { selectionId } });
  if (!p || p.snapshot.page.url !== url)
    throw new Error('This passage is not on the current page.');
  return p;
}
const readingAdmission = createReadingAdmission(currentSettings, db);
function submit(admitted: ReadingAdmission): Promise<ReadingResult<'submit'>> {
  if (admitted.kind === 'reused')
    return Promise.resolve({ passageId: admitted.passageId, reused: true });
  return runnerRequest({
    operation: 'submit',
    submission: admitted.submission,
    credential: admitted.credential,
  });
}
async function reading(
  request: ReadingRequest,
  sender: chrome.runtime.MessageSender,
): Promise<ReadingResult> {
  const url = sourcePage(sender);
  switch (request.action) {
    case 'mute-errors':
      await setErrorNotificationsMuted(request.muted);
      return {};
    case 'policy': {
      const settings = await currentSettings();
      const configuration = configurationFor(settings);
      return {
        policy: settings.contextPolicy,
        selectedRecipeId: configuration.selectedRecipeId,
        recipes: configuration.recipes.map((recipe) => ({
          id: recipe.id,
          name: recipe.name,
          capability: recipe.capability,
          outputFormat: configuration.presets.find((p) => p.id === recipe.presetId)?.imageOptions
            ?.outputFormat,
          presetName:
            configuration.presets.find((preset) => preset.id === recipe.presetId)?.name ||
            'Unavailable preset',
          fast:
            configuration.presets.find((preset) => preset.id === recipe.presetId)?.fast === true,
        })),
      };
    }
    case 'list':
      return { passages: await db({ type: 'DB_PAGE', payload: { url } }) };
    case 'submit':
      return submit(await readingAdmission.submit(request, url));
    default: {
      const passage = await owned(request.selectionId, url);
      switch (request.action) {
        case 'image':
          return db({
            type: 'DB_IMAGE',
            payload: { selectionId: request.selectionId, runId: request.runId },
          });
        case 'review':
          return readingAdmission.review(request, passage);
        case 'regenerate':
          return submit(await readingAdmission.regenerate(request, passage));
        case 'stop':
          await runnerRequest({ operation: 'stop', selectionId: request.selectionId });
          break;
        case 'bookmark':
          await db({
            type: 'DB_SET_BOOKMARK',
            payload: { selectionId: request.selectionId, bookmarked: request.bookmarked },
          });
          break;
        case 'view':
          await db({
            type: 'DB_VIEW',
            payload: { selectionId: request.selectionId, runId: request.runId },
          });
          break;
        case 'runs':
          return {
            runs: await db({ type: 'DB_RUNS', payload: { selectionId: request.selectionId } }),
          };
      }
      return {};
    }
  }
}
const sourceKey = (tabId: number) => `saul-source-${tabId}`;
async function deliverSource(tabId: number) {
  const key = sourceKey(tabId),
    saved = await chrome.storage.session.get(key);
  if (!saved[key]) return;
  try {
    const reply = await chrome.tabs.sendMessage(
      tabId,
      { type: 'SAUL_OPEN', selectionId: saved[key] },
      { frameId: 0 },
    );
    if (reply?.received) await chrome.storage.session.remove(key);
  } catch {
    /* The page's content script will request delivery when mounted. */
  }
}
async function openSource(selectionId: string) {
  const p = await db({ type: 'DB_PASSAGE', payload: { selectionId } });
  if (!p || !/^https?:/.test(p.snapshot.page.url)) throw new Error('This source is unavailable.');
  const existing = (await chrome.tabs.query({})).find(
    (t) => t.url === p.snapshot.page.url && !t.incognito,
  );
  const tab = existing || (await chrome.tabs.create({ url: p.snapshot.page.url }));
  if (tab.id === undefined) throw new Error('Could not open the source page.');
  await chrome.storage.session.set({ [sourceKey(tab.id)]: selectionId });
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  await deliverSource(tab.id);
}
export default defineBackground(() => {
  initSummaryActions();
  initAnnotations(currentSettings);
  const settings = settingsOwner;
  initStorageSecurity();
  initNativeBridge();
  initStorageBridge();
  initCredentialBridge();
  initSpeechBridge(currentSettings);
  initActionBridge();
  void db({ type: 'DB_UNREAD', payload: undefined })
    .then((count) => chrome.action.setBadgeText({ text: count ? String(count) : '' }))
    .catch((error) => console.warn('[Saul] Could not restore reading state', error));
  const subscribers = new Map<chrome.runtime.Port, string>();
  let notificationRevision = 0;
  let presentationRevision = 0;
  function notifyPreference(
    port: chrome.runtime.Port,
    preference:
      | { type: 'notifications'; muted: boolean }
      | { type: 'presentation'; minimum: boolean }
      | { type: 'configuration' },
  ) {
    try {
      port.postMessage(preference);
    } catch {
      subscribers.delete(port);
    }
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (SETTINGS_STORAGE_KEY in changes)
      for (const port of subscribers.keys()) notifyPreference(port, { type: 'configuration' });
    if (NOTIFICATION_STORAGE_KEY in changes) {
      notificationRevision++;
      const muted = changes[NOTIFICATION_STORAGE_KEY]!.newValue === true;
      for (const port of subscribers.keys())
        notifyPreference(port, { type: 'notifications', muted });
    }
    if (MINIMUM_MODE_STORAGE_KEY in changes) {
      presentationRevision++;
      const minimum = minimumModeFromStorage(changes[MINIMUM_MODE_STORAGE_KEY]!.newValue);
      for (const port of subscribers.keys())
        notifyPreference(port, { type: 'presentation', minimum });
    }
  });
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'saul-reading') return;
    try {
      subscribers.set(port, sourcePage(port.sender || {}));
    } catch {
      port.disconnect();
      return;
    }
    port.onDisconnect.addListener(() => subscribers.delete(port));
    const revision = notificationRevision;
    void getErrorNotificationsMuted().then(
      (muted) => {
        if (subscribers.has(port) && revision === notificationRevision)
          notifyPreference(port, { type: 'notifications', muted });
      },
      () => {
        if (subscribers.has(port)) notifyPreference(port, { type: 'notifications', muted: false });
      },
    );
    const appearanceRevision = presentationRevision;
    void getMinimumMode().then(
      (minimum) => {
        if (subscribers.has(port) && appearanceRevision === presentationRevision)
          notifyPreference(port, { type: 'presentation', minimum });
      },
      () => {
        if (subscribers.has(port) && appearanceRevision === presentationRevision)
          notifyPreference(port, { type: 'presentation', minimum: true });
      },
    );
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    void chrome.storage.session.remove(sourceKey(tabId));
  });
  chrome.runtime.onMessage.addListener((request, sender, reply) => {
    if (
      ![
        'saul-digest',
        'saul-action',
        'saul-call-editor',
        'saul-digest-capture',
        'saul-reading',
        'saul-workspace',
        'saul-settings',
        'saul-credential-mode',
        'saul-events',
        'saul-open-source',
        'saul-source-ready',
      ].includes(request?.target) &&
      request?.type !== 'WORKSPACE_TABS'
    )
      return false;
    (async () => {
      if (request.target === 'saul-credential-mode') {
        if (
          sender.id !== chrome.runtime.id ||
          sender.tab ||
          sender.url !== chrome.runtime.getURL('offscreen.html')
        )
          throw new Error('Runner only');
        const route = await readCredentialRoute();
        return { mode: route === 'local' ? 'standalone' : route };
      }
      if (request.target === 'saul-call-editor') {
        if (
          sender.id !== chrome.runtime.id ||
          sender.tab ||
          sender.url !== chrome.runtime.getURL('offscreen.html')
        )
          throw new Error('Runner only');
        const message: CallEditorBridgeRequest = request.message;
        switch (message?.action) {
          case 'read-choices':
            return callStore.readChoices();
          case 'save-choices':
            return callStore.saveChoices(message.source, message.choices);
          case 'read-draft':
            return callStore.readDraft();
          case 'save-draft':
            return callStore.saveDraft(message.draft);
          case 'prepare-preset':
            return prepareCallModel(await currentSettings(), message.presetId);
          default:
            throw new Error('Invalid Call storage request.');
        }
      }
      if (request.target === 'saul-digest-capture') {
        if (
          sender.id !== chrome.runtime.id ||
          sender.url !== chrome.runtime.getURL('offscreen.html') ||
          sender.tab
        )
          throw new Error('Runner only');
        return request.verifyOnly ? verifyCaptureTab(request.item) : captureTab(request.item);
      }
      if (request.target === 'saul-events') {
        if (
          sender.id !== chrome.runtime.id ||
          sender.url !== chrome.runtime.getURL('offscreen.html') ||
          sender.tab
        )
          throw new Error('Runner only');
        for (const [port, url] of subscribers)
          if (request.url === '*' || request.url === url) {
            try {
              port.postMessage({ type: 'changed' });
            } catch {
              subscribers.delete(port);
            }
          }
        const count = await db({ type: 'DB_UNREAD', payload: undefined });
        await chrome.action.setBadgeText({ text: count ? String(count) : '' });
        return;
      }
      if (request.target === 'saul-source-ready') {
        sourcePage(sender);
        await deliverSource(sender.tab!.id!);
        return;
      }
      if (request.target === 'saul-reading') {
        validateReading(request.message);
        return reading(request.message, sender);
      }
      if (!workspaceSender(sender)) throw new Error('Extension workspace only');
      if (request.target === 'saul-settings') return settings(request.message);
      if (request.target === 'saul-action') {
        validateCallEditRequest(request.message);
        return runnerRequest({ operation: 'action', message: request.message });
      }
      if (request.target === 'saul-digest') {
        validateDigest(request.message);
        return runnerRequest({ operation: 'digest', ...(await admitCall(request.message)) });
      }
      if (request.type === 'WORKSPACE_TABS') return workspaceCall(request);
      if (request.target === 'saul-open-source') {
        if (!id(request.selectionId)) throw new Error('Invalid passage');
        return openSource(request.selectionId);
      }
      validateWorkspace(request.message);
      if (request.message.type === 'DB_DELETE_SELECTION')
        return runnerRequest({
          operation: 'delete',
          selectionId: request.message.payload.selectionId,
        });
      if (request.message.type === 'DB_CLEAR_HISTORY')
        return runnerRequest({ operation: 'delete' });
      return db(request.message);
    })().then(
      (result) => reply({ success: true, result }),
      (error) =>
        reply({ success: false, error: error instanceof Error ? error.message : String(error) }),
    );
    return true;
  });
});
