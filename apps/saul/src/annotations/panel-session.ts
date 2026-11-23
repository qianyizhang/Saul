import { MAX_ANNOTATION_BATCH, type AnnotationSummary } from '../../shared/protocol/annotations.ts';
import { annotationMessage } from './client';
import { annotationPanelKey, annotationVersionKey } from './routing';

type Page = { url: string; title: string; tabId: number };
type Filter = 'open' | 'done' | 'deleted' | 'all';
type Choices = Awaited<ReturnType<typeof annotationMessage<'choices'>>>;
type Respond = Parameters<typeof annotationMessage<'respond'>>[0]['options'];
type ResponseOptions = Omit<Respond, 'url' | 'targets'>;
type Snapshot = {
  page?: Page;
  records: AnnotationSummary[];
  selected?: string;
  checked: string[];
  filter: Filter;
  choices: Choices;
  readError: string;
  commandError: string;
  busy: boolean;
};

interface PanelDependencies {
  activePage: () => Promise<Page | undefined>;
  list: (
    url: string,
    filter: Filter,
    offset: number,
    tabId: number,
  ) => Promise<{
    records?: AnnotationSummary[];
    nextOffset?: number;
  }>;
  routedSelection: () => Promise<string | undefined>;
  acknowledgeRoute: () => Promise<void>;
  choices: () => Promise<Choices>;
  capture: () => Promise<void>;
  respond: (options: Respond) => Promise<unknown>;
}

export function annotationTargets({ checked, records }: Snapshot) {
  return checked.length
    ? records.filter((a) => checked.includes(a.id))
    : records.filter((a) => a.state === 'open' && a.comment.trim() && !a.deletedAt);
}

export function createAnnotationPanelSession(deps: PanelDependencies) {
  let state: Snapshot = {
    records: [],
    checked: [],
    filter: 'open',
    choices: { presets: [], calls: [] },
    readError: '',
    commandError: '',
    busy: false,
  };
  let lifetime = 0;
  let scope = 0;
  let request = 0;
  let selectedByUser = 0;
  let running = false;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<Snapshot>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const pageChanged = (page?: Page) => {
    scope++;
    publish({
      page,
      selected: undefined,
      checked: [],
      records: [],
      busy: false,
      readError: '',
      commandError: '',
    });
  };

  async function refresh() {
    if (!running) return;
    const id = ++request;
    const current = () => running && id === request;
    try {
      const page = await deps.activePage();
      if (!current()) return;
      if (page?.url !== state.page?.url || page?.tabId !== state.page?.tabId) pageChanged(page);
      if (!page) {
        if (state.readError) publish({ readError: '' });
        return;
      }
      const records: AnnotationSummary[] = [];
      let offset = 0;
      do {
        const result = await deps.list(page.url, state.filter, offset, page.tabId);
        if (!current()) return;
        records.push(...(result.records ?? []));
        offset = result.nextOffset ?? -1;
      } while (offset >= 0);
      const has = (id?: string) => records.some((item) => item.id === id);
      publish({
        page,
        records,
        readError: '',
        selected: has(state.selected) ? state.selected : undefined,
        checked: state.checked.filter(has),
      });
      const selection = selectedByUser;
      const route = await deps.routedSelection();
      if (current() && selection === selectedByUser && route !== undefined && has(route)) {
        publish({ selected: route });
        await deps.acknowledgeRoute();
      }
    } catch (cause) {
      if (current()) publish({ readError: message(cause) });
    }
  }

  async function respond(options: ResponseOptions) {
    const { page, busy } = state;
    const targets = annotationTargets(state);
    if (
      !running ||
      !page ||
      busy ||
      !options.presetId ||
      !targets.length ||
      targets.length > MAX_ANNOTATION_BATCH ||
      state.filter === 'deleted'
    )
      return;
    const context = scope;
    const selection = selectedByUser;
    publish({ busy: true, commandError: '' });
    try {
      await deps.respond({
        ...options,
        url: page.url,
        targets: targets.map(({ id, revision, url }) => ({
          id,
          revision,
          ...(url !== page.url && { url }),
        })),
      });
      const first = targets[0]?.id;
      if (
        context === scope &&
        selection === selectedByUser &&
        state.records.some((record) => record.id === first)
      )
        publish({ selected: first });
    } catch (cause) {
      if (context === scope) publish({ commandError: message(cause) });
    } finally {
      if (context === scope) publish({ busy: false });
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      const id = ++lifetime;
      running = true;
      void refresh();
      void deps.choices().then(
        (choices) => {
          if (running && id === lifetime) publish({ choices });
        },
        (cause) => {
          if (running && id === lifetime) publish({ commandError: message(cause) });
        },
      );
      return () => {
        running = false;
        request++;
        pageChanged();
      };
    },
    refresh,
    changePage() {
      // Invalidate as soon as Chrome reports navigation. A slow list read must
      // not leave this page's commands attached to the formerly active tab.
      pageChanged();
      return refresh();
    },
    setFilter(filter: Filter) {
      if (state.filter === filter) return;
      scope++;
      publish({
        filter,
        selected: undefined,
        checked: [],
        records: [],
        busy: false,
        commandError: '',
      });
      void refresh();
    },
    select(id: string) {
      if (!state.records.some((record) => record.id === id)) return;
      selectedByUser++;
      publish({ selected: id });
    },
    check(id: string, checked: boolean) {
      if (!state.records.some((record) => record.id === id)) return;
      publish({
        checked: checked
          ? [...new Set([...state.checked, id])]
          : state.checked.filter((previous) => previous !== id),
      });
    },
    async capture() {
      const context = scope;
      try {
        await deps.capture();
      } catch (cause) {
        if (context === scope) publish({ commandError: message(cause) });
      }
    },
    respond,
  };
}

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

export function chromeAnnotationPanel(windowId: number) {
  const key = annotationPanelKey(windowId);
  const session = createAnnotationPanelSession({
    async activePage() {
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      if (tab?.id !== undefined && !tab.incognito && tab.url && /^https?:/.test(tab.url))
        return { url: tab.url, title: tab.title ?? tab.url, tabId: tab.id };
    },
    list: (url, filter, _offset, tabId) =>
      annotationMessage({ action: 'page-index', url, filter, tabId }),
    async routedSelection() {
      const route: unknown = (await chrome.storage.session.get(key))[key];
      if (route && typeof route === 'object' && 'id' in route && typeof route.id === 'string')
        return route.id;
    },
    acknowledgeRoute: () => chrome.storage.session.set({ [key]: { view: 'annotations' } }),
    choices: () => annotationMessage({ action: 'choices' }),
    capture: () => annotationMessage({ action: 'start-capture' }),
    respond: (options) => annotationMessage({ action: 'respond', options }),
  });
  return {
    ...session,
    observe() {
      const stop = session.start();
      const updated = (tabId: number, change: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
        if (tab.windowId !== windowId || !tab.active) return;
        const page = session.getSnapshot().page;
        if (change.url && page && (page.tabId !== tabId || page.url !== change.url))
          void session.changePage();
        else if (change.url || change.status === 'complete') void session.refresh();
      };
      const activated = (info: chrome.tabs.OnActivatedInfo) => {
        if (info.windowId === windowId) void session.changePage();
      };
      const stored = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area === 'session' && (changes[annotationVersionKey] || changes[key]))
          void session.refresh();
      };
      chrome.tabs.onActivated.addListener(activated);
      chrome.tabs.onUpdated.addListener(updated);
      chrome.storage.onChanged.addListener(stored);
      return () => {
        chrome.tabs.onActivated.removeListener(activated);
        chrome.tabs.onUpdated.removeListener(updated);
        chrome.storage.onChanged.removeListener(stored);
        stop();
      };
    },
  };
}
