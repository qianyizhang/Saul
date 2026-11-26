import { z } from 'zod';
import { workspaceSender } from '../platform/chrome/sender';
import { runChatGPTComposer } from './composer';
import {
  articleUrl,
  chatUrl,
  CHATGPT_ORIGIN,
  CHAT_PATH_PATTERN,
  DEEP_DIVE_INSTRUCTION,
  DEEP_DIVE_MENU,
  DEEP_DIVE_RECORDS,
  deepDiveRecords,
  deepDiveRequest,
  DEFAULT_INSTRUCTION,
  instructionText,
  type DeepDive,
  type DeepDiveRequest,
  type Handoff,
} from './model';

const TAB_BINDINGS = 'saul_deep_dive_tabs';
const DEADLINE = 'saul-deep-dive:';
const HANDOFF_TIMEOUT = 60_000;

const tabBindings = z.record(
  z.uuid(),
  z.object({ tabId: z.number().int().nonnegative(), prepareDraft: z.boolean() }),
);

async function records(): Promise<DeepDive[]> {
  const stored = await chrome.storage.local.get(DEEP_DIVE_RECORDS);
  return deepDiveRecords.parse(stored[DEEP_DIVE_RECORDS] ?? []);
}

async function instruction() {
  const stored = await chrome.storage.local.get(DEEP_DIVE_INSTRUCTION);
  return instructionText.parse(stored[DEEP_DIVE_INSTRUCTION] ?? DEFAULT_INSTRUCTION);
}

async function tabs() {
  const stored = await chrome.storage.session.get(TAB_BINDINGS);
  return tabBindings.parse(stored[TAB_BINDINGS] ?? {});
}

async function setHandoff(id: string, handoff: Handoff) {
  const items = await records();
  await chrome.storage.local.set({
    [DEEP_DIVE_RECORDS]: items.map((item) => (item.id === id ? { ...item, handoff } : item)),
  });
}

async function focusTab(id: number) {
  const tab = await chrome.tabs.update(id, { active: true });
  if (tab) await chrome.windows.update(tab.windowId, { focused: true });
}

const active = (item: DeepDive) => ['opening', 'sending'].includes(item.handoff.phase);
const onChatGPT = (url: string | undefined) => !!url && URL.parse(url)?.origin === CHATGPT_ORIGIN;

export function initDeepDives() {
  let queue: Promise<unknown> = Promise.resolve();
  const verifying = new Set<string>();
  let launchError = '';

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation);
    queue = result.catch(() => undefined);
    return result;
  }

  function handle(effect: Promise<unknown>) {
    void effect.catch(() => console.warn('[Saul] Deep dive history could not be updated.'));
  }

  async function release(id: string) {
    const bindings = await tabs();
    if (id in bindings) {
      delete bindings[id];
      await chrome.storage.session.set({ [TAB_BINDINGS]: bindings });
    }
    await chrome.alarms.clear(DEADLINE + id);
  }

  async function associatedTab(id: string) {
    const tabId = (await tabs())[id]?.tabId;
    if (tabId === undefined) return;
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (tab && onChatGPT(tab.url)) return tabId;
  }

  async function launchTab(
    id: string,
    options: chrome.tabs.CreateProperties,
    prepareDraft: boolean,
  ) {
    const tab = await chrome.tabs.create({ ...options, url: 'about:blank' });
    if (tab.id === undefined) throw new Error('Could not open a ChatGPT tab.');
    const bindings = await tabs();
    await chrome.storage.session.set({
      [TAB_BINDINGS]: { ...bindings, [id]: { tabId: tab.id, prepareDraft } },
    });
    await chrome.tabs.update(tab.id, { url: CHATGPT_ORIGIN });
    // Inspect the current tab as well as listening for future committed changes.
    handle(inspectTab(tab.id));
  }

  async function open(item: DeepDive) {
    if (item.handoff.phase === 'sent') {
      const { url } = item.handoff;
      const existing = (await chrome.tabs.query({ url: `${CHATGPT_ORIGIN}/*` })).find(
        (tab) => !tab.incognito && chatUrl(tab.url) === url,
      );
      if (existing?.id !== undefined) await focusTab(existing.id);
      else await chrome.tabs.create({ url });
      return;
    }
    const tabId = await associatedTab(item.id);
    if (tabId !== undefined) await focusTab(tabId);
    else if (item.handoff.phase === 'draft') await launchTab(item.id, { active: true }, true);
    else await chrome.tabs.create({ url: CHATGPT_ORIGIN });
  }

  async function start(source: chrome.tabs.Tab) {
    const article = articleUrl(source.url);
    if (source.id === undefined || source.incognito || !article) return;
    launchError = '';
    const items = await records();
    const existing = items.find((item) => item.article === article);
    if (existing) {
      if (!active(existing)) await open(existing);
      return;
    }
    const id = crypto.randomUUID();
    const item: DeepDive = {
      id,
      article,
      title: source.title?.trim().slice(0, 500) || article,
      prompt: `${await instruction()}\n\nArticle: ${article}`,
      createdAt: Date.now(),
      handoff: { phase: 'opening' },
    };
    await chrome.storage.local.set({ [DEEP_DIVE_RECORDS]: [item, ...items] });
    try {
      await chrome.alarms.create(DEADLINE + id, { when: item.createdAt + HANDOFF_TIMEOUT });
      await launchTab(
        id,
        { windowId: source.windowId, index: source.index + 1, active: false },
        false,
      );
    } catch {
      await setHandoff(id, { phase: 'draft' });
      await release(id);
    }
  }

  async function inspectTab(tabId: number) {
    const request = await serialize(async () => {
      const bindings = await tabs();
      const match = Object.entries(bindings).find(([, binding]) => binding.tabId === tabId);
      const item = match && (await records()).find((record) => record.id === match[0]);
      if (!match || !item || item.handoff.phase === 'sent' || verifying.has(item.id)) return;
      const tab = await chrome.tabs.get(tabId).catch(() => undefined);
      if (!tab || tab.incognito || !onChatGPT(tab.url)) return;
      const fresh =
        tab.status === 'complete' && !tab.pendingUrl && tab.url === `${CHATGPT_ORIGIN}/`;
      if (item.handoff.phase === 'opening' && fresh) {
        if (Date.now() >= item.createdAt + HANDOFF_TIMEOUT) {
          await setHandoff(item.id, { phase: 'draft' });
          return;
        }
        await setHandoff(item.id, { phase: 'sending' });
        // The durable transition precedes the only invocation that may click Send.
        verifying.add(item.id);
        return { item, action: 'send' as const };
      }
      if (item.handoff.phase === 'draft' && fresh && match[1].prepareDraft) {
        bindings[item.id] = { tabId, prepareDraft: false };
        await chrome.storage.session.set({ [TAB_BINDINGS]: bindings });
        verifying.add(item.id);
        return { item, action: 'draft' as const };
      }
      if (chatUrl(tab.url)) {
        verifying.add(item.id);
        return { item, action: 'verify' as const };
      }
    });
    if (!request) return;
    const { item, action } = request;
    let result: Handoff | undefined;
    try {
      // A navigation or disconnect can happen just after a click.
      const frames = await chrome.scripting
        .executeScript({
          target: { tabId, frameIds: [0] },
          func: runChatGPTComposer,
          args: [
            action,
            item.prompt,
            CHATGPT_ORIGIN,
            CHAT_PATH_PATTERN,
            item.createdAt + HANDOFF_TIMEOUT,
          ],
        })
        .catch(() => []);
      result = frames[0]?.result;
      await serialize(async () => {
        if ((await tabs())[item.id]?.tabId !== tabId) return;
        const latest = (await records()).find((record) => record.id === item.id);
        if (!latest || latest.handoff.phase === 'sent') return;
        if (result?.phase === 'sent' && chatUrl(result.url) === result.url) {
          await setHandoff(item.id, result);
          await release(item.id);
        } else if (action === 'send' && latest.handoff.phase === 'sending') {
          await setHandoff(item.id, result?.phase === 'draft' ? result : { phase: 'uncertain' });
          await chrome.alarms.clear(DEADLINE + item.id);
        }
      });
    } finally {
      verifying.delete(item.id);
    }
    // A full-page navigation can cut off the injected script. Read the new document once.
    if (action !== 'verify' && result?.phase !== 'sent') {
      const current = await chrome.tabs.get(tabId).catch(() => undefined);
      if (current && chatUrl(current.url)) await inspectTab(tabId);
    }
  }

  async function reconcile() {
    const observe = await serialize(async () => {
      const bindings = await tabs();
      const items = await records();
      const present: number[] = [];
      for (const item of items) {
        const tabId = bindings[item.id]?.tabId;
        const tab =
          tabId === undefined ? undefined : await chrome.tabs.get(tabId).catch(() => undefined);
        if (tab?.id !== undefined) present.push(tab.id);
        else if (item.handoff.phase === 'opening') await setHandoff(item.id, { phase: 'draft' });
        else if (item.handoff.phase === 'sending')
          await setHandoff(item.id, { phase: 'uncertain' });
      }
      return present;
    });
    await Promise.all(observe.map((tabId) => inspectTab(tabId)));
  }

  async function workspace(message: DeepDiveRequest) {
    switch (message.action) {
      case 'list':
        return { items: await records(), error: launchError };
      case 'instruction':
        return instruction();
      case 'save-instruction':
        if ((await instruction()) !== message.expected)
          throw new Error('The instruction changed in another window. Reload it before saving.');
        await chrome.storage.local.set({ [DEEP_DIVE_INSTRUCTION]: message.value });
        return message.value;
      case 'open':
      case 'remove': {
        const items = await records();
        const item = items.find(({ id }) => id === message.id);
        if (!item) return;
        if (message.action === 'open') return open(item);
        if (active(item)) throw new Error('Wait for the current handoff before removing it.');
        await chrome.storage.local.set({
          [DEEP_DIVE_RECORDS]: items.filter(({ id }) => id !== item.id),
        });
        await release(item.id);
      }
    }
  }

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== DEEP_DIVE_MENU || !tab) return;
    handle(
      serialize(() => start(tab)).catch(async () => {
        launchError = 'Saul could not save the article. Try Save & deep dive again.';
        await chrome.tabs.create({ url: chrome.runtime.getURL('library.html#deep-dives') });
      }),
    );
  });
  chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (onChatGPT(tab.url) && (change.status === 'complete' || change.url))
      handle(inspectTab(tabId));
  });
  chrome.tabs.onRemoved.addListener((tabId) =>
    handle(
      serialize(async () => {
        const binding = Object.entries(await tabs()).find(([, value]) => value.tabId === tabId);
        if (!binding) return;
        const [id] = binding;
        const item = (await records()).find((record) => record.id === id);
        if (item?.handoff.phase === 'opening') await setHandoff(id, { phase: 'draft' });
        if (item?.handoff.phase === 'sending') await setHandoff(id, { phase: 'uncertain' });
        await release(id);
      }),
    ),
  );
  chrome.alarms.onAlarm.addListener(({ name }) => {
    if (!name.startsWith(DEADLINE)) return;
    const id = name.slice(DEADLINE.length);
    handle(
      serialize(async () => {
        const item = (await records()).find((record) => record.id === id);
        if (item?.handoff.phase === 'opening') await setHandoff(id, { phase: 'draft' });
        if (item?.handoff.phase === 'sending') await setHandoff(id, { phase: 'uncertain' });
      }),
    );
  });
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.target !== 'saul-deep-dives') return false;
    if (!workspaceSender(sender)) {
      reply({ success: false, error: 'Extension workspace only.' });
      return false;
    }
    void serialize(async () => workspace(deepDiveRequest.parse(message.message))).then(
      (result) => reply({ success: true, result }),
      (error) =>
        reply({ success: false, error: error instanceof Error ? error.message : String(error) }),
    );
    return true;
  });
  handle(reconcile());
}
