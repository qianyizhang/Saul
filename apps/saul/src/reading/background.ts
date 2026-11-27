import { isId, isRecord } from '../../shared/model/value.mts';
import type { Passage } from '../../shared/protocol/history-types.ts';
import { configurationFor, type Configuration } from '../configuration/definition';
import { SETTINGS_STORAGE_KEY } from '../configuration/store';
import { HISTORY_WORKSPACE_TARGET, validateWorkspace } from '../contracts/workspace';
import { runnerRequest, type RunnerDbCall } from '../platform/chrome/runner';
import { offscreenSender, sourcePage, workspaceSender } from '../platform/chrome/sender';
import {
  getErrorNotificationsMuted,
  setErrorNotificationsMuted,
  NOTIFICATION_STORAGE_KEY,
} from '../storage/notifications';
import {
  getMinimumMode,
  minimumModeFromStorage,
  MINIMUM_MODE_STORAGE_KEY,
} from '../storage/presentation';
import { createReadingAdmission, type ReadingAdmission } from './admission';
import {
  OPEN_SOURCE_TARGET,
  READING_EVENTS_TARGET,
  READING_TARGET,
  SOURCE_READY_TARGET,
  receivedSource,
  validateReading,
  type OpenSourceMessage,
  type ReadingEvent,
  type ReadingRequest,
  type ReadingResult,
} from './contract';

const targets = new Set([
  READING_EVENTS_TARGET,
  SOURCE_READY_TARGET,
  READING_TARGET,
  OPEN_SOURCE_TARGET,
  HISTORY_WORKSPACE_TARGET,
]);

export function initReadingHost(db: RunnerDbCall, currentSettings: () => Promise<Configuration>) {
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
    if (typeof saved[key] !== 'string' || !saved[key]) return;
    try {
      const reply: unknown = await chrome.tabs.sendMessage(
        tabId,
        { type: 'SAUL_OPEN', selectionId: saved[key] } satisfies OpenSourceMessage,
        { frameId: 0 },
      );
      if (receivedSource(reply)) await chrome.storage.session.remove(key);
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
  void db({ type: 'DB_UNREAD', payload: undefined })
    .then((count) => chrome.action.setBadgeText({ text: count ? String(count) : '' }))
    .catch((error) => console.warn('[Saul] Could not restore reading state', error));
  const subscribers = new Map<chrome.runtime.Port, string>();
  let notificationRevision = 0;
  let presentationRevision = 0;
  function notifyPreference(port: chrome.runtime.Port, preference: ReadingEvent) {
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
    if (port.name !== READING_TARGET) return;
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
        if (subscribers.has(port) && revision === notificationRevision)
          notifyPreference(port, { type: 'notifications', muted: false });
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
  chrome.runtime.onMessage.addListener((request: unknown, sender, reply) => {
    if (!isRecord(request) || typeof request.target !== 'string' || !targets.has(request.target))
      return false;
    void (async () => {
      if (request.target === READING_EVENTS_TARGET) {
        if (!offscreenSender(sender)) throw new Error('Runner only');
        if (typeof request.url !== 'string') throw new Error('Invalid reading event.');
        for (const [port, url] of subscribers)
          if (request.url === '*' || request.url === url) {
            notifyPreference(port, { type: 'changed' });
          }
        const count = await db({ type: 'DB_UNREAD', payload: undefined });
        await chrome.action.setBadgeText({ text: count ? String(count) : '' });
        return;
      }
      if (request.target === SOURCE_READY_TARGET) {
        sourcePage(sender);
        await deliverSource(sender.tab!.id!);
        return;
      }
      if (request.target === READING_TARGET) {
        validateReading(request.message);
        return reading(request.message, sender);
      }
      if (!workspaceSender(sender)) throw new Error('Extension workspace only');
      if (request.target === OPEN_SOURCE_TARGET) {
        if (!isId(request.selectionId)) throw new Error('Invalid passage');
        return openSource(request.selectionId);
      }
      validateWorkspace(request.message);
      if (request.message.type === 'DB_DELETE_SELECTION')
        return runnerRequest({
          operation: 'delete',
          ...request.message.payload,
        });
      if (request.message.type === 'DB_CLEAR_HISTORY')
        return runnerRequest({ operation: 'clear-history' });
      return db(request.message);
    })().then(
      (result) => reply({ success: true, result }),
      (error) =>
        reply({ success: false, error: error instanceof Error ? error.message : String(error) }),
    );
    return true;
  });
}
