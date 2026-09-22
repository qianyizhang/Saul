import { getSettings, initStorageSecurity } from '../src/storage/settings';
import {
  getErrorNotificationsMuted,
  setErrorNotificationsMuted,
  NOTIFICATION_STORAGE_KEY,
} from '../src/storage/notifications';
import { runnerRequest } from '../src/storage/client';
import { renderExplainPrompt, DEFAULT_SYSTEM_PROMPT } from '../src/models/prompts';
import { initNativeBridge } from '../src/native/bridge';
import { workspaceCall } from '../src/native/workspace';
import {
  sourcePage,
  validateReading,
  workspaceSender,
  id,
  type ReadingRequest,
  type ReadingResult,
} from '../src/contracts/reading';
import { validateWorkspace } from '../src/contracts/workspace';
import type { DbCall, DbRequest, Passage, RunInput } from '../src/types/storage';
import type { ResolvedContext, SelectionSnapshot } from '../src/types';

const db: DbCall = (message) => runnerRequest({ operation: 'db', message: message as DbRequest });
async function owned(selectionId: string, url: string): Promise<Passage> {
  const p = await db({ type: 'DB_PASSAGE', payload: { selectionId } });
  if (!p || p.snapshot.page.url !== url)
    throw new Error('This passage is not on the current page.');
  return p;
}
async function submit(
  snapshot: SelectionSnapshot,
  context: ResolvedContext,
  submissionId: string,
  regenerate: boolean,
  instruction?: string,
) {
  const settings = await getSettings();
  const { apiKey, ...remote } = settings.openaiCompatible;
  if (settings.activeProvider !== 'chrome-ai') {
    const url = new URL(remote.baseUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('Configure a valid HTTP(S) model endpoint in Saul Settings.');
    if (!apiKey && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      throw new Error('API key is missing. Configure it in Saul Settings.');
  }
  const language = settings.responseLanguage
    ? `Respond in ${settings.responseLanguage}.`
    : 'Respond in the language of the selected text.';
  const input: RunInput = {
    provider: settings.activeProvider,
    remote,
    local: settings.chromeAi,
    context,
    systemPrompt: settings.customPromptTemplate || DEFAULT_SYSTEM_PROMPT,
    userPrompt: renderExplainPrompt(context, [instruction, language].filter(Boolean).join('\n')),
  };
  return runnerRequest<{ passageId: string; reused: boolean }>({
    operation: 'submit',
    submission: { snapshot, input, submissionId, regenerate },
    credential: settings.activeProvider === 'chrome-ai' ? '' : apiKey,
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
    case 'policy':
      return { policy: (await getSettings()).contextPolicy };
    case 'list':
      return { passages: await db({ type: 'DB_PAGE', payload: { url } }) };
    case 'submit': {
      if (request.snapshot.page.url !== url)
        throw new Error('The page changed. Select the passage again.');
      const snapshot = { ...request.snapshot, page: { ...request.snapshot.page, url } };
      const context = {
        ...request.context,
        selection: snapshot.text,
        pageUrl: request.context.pageUrl ? url : '',
      };
      return submit(snapshot, context, request.submissionId, false);
    }
    default: {
      const passage = await owned(request.selectionId, url);
      switch (request.action) {
        case 'regenerate': {
          const context = await db({
            type: 'DB_CONTEXT',
            payload: { selectionId: request.selectionId },
          });
          const instruction = request.instruction
            ? `Previous explanation:\n${passage.completed?.responseRaw || passage.latest.responseRaw}\n\nFollow-up request: ${request.instruction}`
            : undefined;
          return submit(passage.snapshot, context, request.submissionId, true, instruction);
        }
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
  initStorageSecurity();
  initNativeBridge();
  void db({ type: 'DB_UNREAD', payload: undefined })
    .then((count) => chrome.action.setBadgeText({ text: count ? String(count) : '' }))
    .catch((error) => console.warn('[Saul] Could not restore reading state', error));
  const subscribers = new Map<chrome.runtime.Port, string>();
  let notificationRevision = 0;
  function notifyPreference(port: chrome.runtime.Port, muted: boolean) {
    try {
      port.postMessage({ type: 'notifications', muted });
    } catch {
      subscribers.delete(port);
    }
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(NOTIFICATION_STORAGE_KEY in changes)) return;
    notificationRevision++;
    const muted = changes[NOTIFICATION_STORAGE_KEY]!.newValue === true;
    for (const port of subscribers.keys()) notifyPreference(port, muted);
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
          notifyPreference(port, muted);
      },
      () => {
        if (subscribers.has(port)) notifyPreference(port, false);
      },
    );
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    void chrome.storage.session.remove(sourceKey(tabId));
  });
  chrome.runtime.onMessage.addListener((request, sender, reply) => {
    if (
      ![
        'saul-reading',
        'saul-workspace',
        'saul-events',
        'saul-open-source',
        'saul-source-ready',
      ].includes(request?.target) &&
      request?.type !== 'WORKSPACE_TABS'
    )
      return false;
    (async () => {
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
