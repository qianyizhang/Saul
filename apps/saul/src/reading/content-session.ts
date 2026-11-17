import { useEffect, useState, useRef } from 'react';
import { captureSelection, buildResolvedContext } from '../capture/selection';
import { sendReadingMessage } from '../reading/client';
import type { ReadingRequest } from './contract';
import type { ReadingOperations } from './contract';
import { EXPLAIN_RECIPE_ID } from '../../shared/model/action-ids.ts';
import type { Passage } from '../../shared/protocol/history-types.ts';
import { PassageMarkers } from '../reading/markers';
import type { InputComparison } from '../reading/input-change';
type Captured = NonNullable<ReturnType<typeof captureSelection>>;
export function useReadingSession(isContextValid: () => boolean) {
  const [passages, setPassages] = useState<Passage[]>([]),
    [captured, setCaptured] = useState<Captured | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null),
    [pinned, setPinned] = useState(false),
    [list, setList] = useState(false);
  const [busy, setBusy] = useState(false),
    [toast, setToast] = useState<{ text: string; id?: string; error?: boolean } | null>(null);
  const [, redraw] = useState(0);
  const [errorsMuted, setErrorsMuted] = useState<boolean | null>(null);
  const [minimum, setMinimum] = useState(true);
  const [followUpDrafts, setFollowUpDrafts] = useState<Record<string, string>>({});
  const [reuse, setReuse] = useState<{
    id: string;
    selection: Captured;
    comparison?: InputComparison;
  }>();
  const [recipes, setRecipes] = useState<ReadingOperations['policy']['result']['recipes']>([]);
  const [defaultRecipeId, setDefaultRecipeId] = useState(EXPLAIN_RECIPE_ID);
  const [recipeChoice, setRecipeChoice] = useState<string | null>(null);
  const [outputFormat, setOutputFormat] = useState<'png' | 'gif' | undefined>();
  const [muting, setMuting] = useState(false);
  const routeGeneration = useRef(0);
  const command = useRef<object | undefined>(undefined);
  const routeIdentity = () => ({ generation: routeGeneration.current, url: location.href });
  const currentRoute = (owner: ReturnType<typeof routeIdentity>) =>
    isContextValid() && owner.generation === routeGeneration.current && owner.url === location.href;
  async function muteErrors() {
    if (muting) return;
    setMuting(true);
    try {
      await sendReadingMessage({ action: 'mute-errors', muted: true });
      setErrorsMuted(true);
      setToast(null);
    } catch {
      setToast({
        text: 'Could not save mute preference. Try again from Saul Settings.',
        error: true,
      });
    } finally {
      setMuting(false);
    }
  }
  const markers = useRef<PassageMarkers | null>(null),
    current = useRef(passages),
    activeRef = useRef(activeId);
  const refreshRef = useRef<() => Promise<void>>(async () => {}),
    openRef = useRef<(id: string, scroll?: boolean) => void>(() => {});
  const active = passages.find((p) => p.snapshot.id === activeId);
  function open(id: string, scroll = false) {
    setReuse(undefined);
    activeRef.current = id;
    setActiveId(id);
    setCaptured(null);
    setList(false);
    setPinned(false);
    setToast(null);
    const attachment = markers.current?.attachments.get(id);
    if (scroll && attachment?.state === 'attached') {
      const node = attachment.range.startContainer;
      (node instanceof Element ? node : node.parentElement)?.scrollIntoView({
        block: 'center',
        behavior: 'instant',
      });
    }
  }
  openRef.current = open;
  useEffect(() => {
    try {
      const renderer = new PassageMarkers(
        (id) => openRef.current(id),
        () => redraw((n) => n + 1),
      );
      markers.current = renderer;
      return () => {
        renderer.destroy();
        markers.current = null;
      };
    } catch (error) {
      setToast({ text: (error as Error).message, error: true });
    }
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 10000 : 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    let disposed = false,
      inflight: Promise<void> | undefined,
      again = false,
      port: chrome.runtime.Port | undefined,
      reconnect: ReturnType<typeof setTimeout> | undefined;
    let route = location.href;
    let preferenceReceived = false;
    let policyRequest = 0;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    const announced = new Set<string>();
    const summary = () => {
      if (disposed || !isContextValid() || document.visibilityState !== 'visible') return;
      const unread = current.current.filter((p) => p.unread && p.snapshot.id !== activeRef.current);
      if (unread.length)
        setToast({
          text: unread.length === 1 ? 'Explanation ready' : `${unread.length} explanations ready`,
          id: unread[0]!.snapshot.id,
        });
    };
    function refresh(): Promise<void> {
      if (disposed || !isContextValid()) return Promise.resolve();
      if (inflight) {
        again = true;
        return inflight;
      }
      inflight = refreshLoop().finally(() => {
        inflight = undefined;
      });
      return inflight;
    }
    async function refreshLoop() {
      do {
        again = false;
        syncRoute();
        const generation = routeGeneration.current;
        const url = route;
        try {
          const result = await sendReadingMessage({ action: 'list' });
          if (disposed || !isContextValid()) return;
          if (url !== location.href || generation !== routeGeneration.current) {
            again = true;
            continue;
          }
          const next = result.passages;
          current.current = next;
          markers.current?.set(next);
          setPassages(next);
          if (next.some((p) => p.unread && p.completed && !announced.has(p.completed.id))) {
            for (const p of next) if (p.completed) announced.add(p.completed.id);
            clearTimeout(readyTimer);
            readyTimer = setTimeout(summary, 600);
          }
        } catch (error) {
          if (
            !disposed &&
            isContextValid() &&
            url === location.href &&
            generation === routeGeneration.current
          )
            setToast({ text: (error as Error).message, error: true });
        }
      } while (again && !disposed);
    }
    refreshRef.current = refresh;
    function connectPort() {
      if (disposed || !isContextValid()) return;
      const connected = chrome.runtime.connect({ name: 'saul-reading' });
      port = connected;
      connected.onMessage.addListener((message) => {
        if (disposed || !isContextValid() || port !== connected) return;
        if (message.type === 'notifications') {
          setErrorsMuted(message.muted === true);
          // Never resurrect a previously suppressed error when unmuting.
          if (preferenceReceived || message.muted === true)
            setToast((current) => (current?.error ? null : current));
          preferenceReceived = true;
        } else if (message.type === 'configuration') {
          void refreshRecipes();
        } else if (message.type === 'presentation') {
          setMinimum(message.minimum !== false);
        } else void refresh();
      });
      connected.onDisconnect.addListener(() => {
        if (disposed || !isContextValid() || port !== connected) return;
        port = undefined;
        reconnect = setTimeout(connect, 1000);
      });
    }
    function connect() {
      connectPort();
      void refresh();
      void refreshRecipes();
    }
    async function refreshRecipes() {
      const request = ++policyRequest;
      try {
        const configuration = await sendReadingMessage({ action: 'policy' });
        if (disposed || !isContextValid() || request !== policyRequest) return;
        setRecipes(configuration.recipes);
        setDefaultRecipeId(configuration.selectedRecipeId);
      } catch (error) {
        if (!disposed && isContextValid() && request === policyRequest)
          setToast({ text: (error as Error).message, error: true });
      }
    }
    function syncRoute() {
      if (route === location.href) return false;
      route = location.href;
      routeGeneration.current++;
      command.current = undefined;
      setBusy(false);
      setReuse(undefined);
      activeRef.current = null;
      setPinned(false);
      announced.clear();
      clearTimeout(readyTimer);
      current.current = [];
      markers.current?.set([]);
      setPassages([]);
      setActiveId(null);
      setCaptured(null);
      setToast(null);
      const previous = port;
      port = undefined;
      previous?.disconnect();
      clearTimeout(reconnect);
      connectPort();
      return true;
    }
    const visible = () => {
      if (document.visibilityState === 'visible') {
        void refresh().then(summary);
      }
    };
    const source = (
      message: { type?: string; selectionId?: string },
      _sender: chrome.runtime.MessageSender,
      reply: (value: unknown) => void,
    ) => {
      if (message.type !== 'SAUL_OPEN' || !message.selectionId) return false;
      const id = message.selectionId;
      void refresh().then(() => {
        if (disposed || !isContextValid()) return;
        const received = current.current.some((p) => p.snapshot.id === id);
        if (received) openRef.current(id, true);
        reply({ received });
      });
      return true;
    };
    chrome.runtime.onMessage.addListener(source);
    connect();
    void chrome.runtime.sendMessage({ target: 'saul-source-ready' }).catch(() => undefined);
    document.addEventListener('visibilitychange', visible);
    // pushState has no browser event; reset attachments/subscriptions when its URL changes.
    const routeTimer = setInterval(() => {
      // Reading WXT's validity flag triggers its registered UI teardown on reload.
      if (isContextValid() && syncRoute()) void refresh();
    }, 750);
    return () => {
      disposed = true;
      routeGeneration.current++;
      command.current = undefined;
      refreshRef.current = async () => {};
      clearInterval(routeTimer);
      clearTimeout(reconnect);
      clearTimeout(readyTimer);
      document.removeEventListener('visibilitychange', visible);
      // Chrome already disconnected an invalidated context; its port methods now throw.
      if (isContextValid() && chrome.runtime?.id) {
        port?.disconnect();
        chrome.runtime.onMessage.removeListener(source);
      }
    };
  }, [isContextValid]);
  useEffect(() => {
    const run = active?.completed;
    if (!active || !run || run.viewedAt !== undefined) return;
    const generation = routeGeneration.current;
    const url = location.href;
    let matching = true;
    const current = () =>
      matching &&
      generation === routeGeneration.current &&
      url === location.href &&
      isContextValid();
    void sendReadingMessage({ action: 'view', selectionId: active.snapshot.id, runId: run.id })
      .then(() => {
        if (current()) return refreshRef.current();
      })
      .catch((error: Error) => {
        if (current()) setToast({ text: error.message, error: true });
      });
    return () => {
      matching = false;
    };
  }, [active?.snapshot.id, active?.completed?.id, active?.completed?.viewedAt, isContextValid]);

  // Treat a user command as belonging to the current route and serialize it
  // before crossing Chrome's asynchronous boundary. Route changes abandon its
  // reply, not work that was already accepted by the runner.
  async function perform<T>(work: (matchesRoute: () => boolean) => Promise<T>) {
    if (command.current || !isContextValid()) return;
    const owner = routeIdentity();
    const identity = {};
    command.current = identity;
    setBusy(true);
    const matchesRoute = () => command.current === identity && currentRoute(owner);
    try {
      const result = await work(matchesRoute);
      return matchesRoute() ? result : undefined;
    } catch (error) {
      if (matchesRoute()) setToast({ text: (error as Error).message, error: true });
    } finally {
      if (command.current === identity) {
        command.current = undefined;
        if (isContextValid()) setBusy(false);
      }
    }
  }
  function action(message: ReadingRequest) {
    return perform(async (matchesRoute) => {
      const result = await sendReadingMessage(message);
      if (matchesRoute()) await refreshRef.current();
      return result;
    });
  }
  async function explain(
    selection: Captured | null = captured,
    regenerate = false,
    presentation: 'queue' | 'open' = 'queue',
  ) {
    if (!selection) return;
    const requestedRecipeId = recipeChoice || (recipes.length ? defaultRecipeId : undefined);
    await perform(async (matchesRoute) => {
      const { policy, selectedRecipeId } = await sendReadingMessage({ action: 'policy' });
      if (!matchesRoute()) return;
      const recipeId = requestedRecipeId || selectedRecipeId;
      if (location.href !== selection.snapshot.page.url)
        throw new Error('The page changed. Select the passage again.');
      const context = buildResolvedContext(selection.snapshot, selection.range, policy);
      async function showReuse(id: string) {
        open(id);
        setReuse({ id, selection: selection! });
        try {
          const comparison = await sendReadingMessage({
            action: 'review',
            selectionId: id,
            context,
            recipeId,
          });
          if (matchesRoute() && activeRef.current === id)
            setReuse({ id, selection: selection!, comparison });
        } catch (error) {
          if (matchesRoute() && activeRef.current === id)
            setReuse({
              id,
              selection: selection!,
              comparison: { fields: [], error: (error as Error).message },
            });
        }
      }
      const result = await sendReadingMessage({
        action: 'submit',
        submissionId: regenerate ? crypto.randomUUID() : selection.snapshot.id,
        snapshot: selection.snapshot,
        context,
        recipeId,
        ...(recipes.find((r) => r.id === recipeId)?.capability === 'draw'
          ? {
              outputFormat:
                outputFormat ?? recipes.find((r) => r.id === recipeId)?.outputFormat ?? 'png',
            }
          : {}),
        ...(regenerate ? { regenerate: true } : {}),
      });
      if (!matchesRoute() || location.href !== selection.snapshot.page.url) return;
      setCaptured(null);
      window.getSelection()?.removeAllRanges();
      // Opening belongs to the accepted user action, never to a later completion.
      // Set it before refreshing so Close/Escape during that read stays authoritative.
      if (presentation === 'open' && result.passageId) {
        if (result.reused) await showReuse(result.passageId);
        else open(result.passageId);
      } else {
        setToast({ text: result.reused ? 'Request available' : 'Waiting…', id: result.passageId });
      }
      if (matchesRoute()) await refreshRef.current();
    });
  }
  const explainRef = useRef(explain);
  explainRef.current = explain;
  const stopRef = useRef<() => void>(() => {});
  stopRef.current = () => {
    if (active && ['queued', 'running'].includes(active.latest.status))
      void action({ action: 'stop', selectionId: active.snapshot.id });
  };
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const inside = (e: Event) =>
      e.composedPath().some((n) => n instanceof Element && n.tagName.toLowerCase() === 'saul-root');
    const editing = (e: Event) =>
      e
        .composedPath()
        .some(
          (node) =>
            node instanceof Element && !!node.closest('input,textarea,select,[contenteditable]'),
        );
    const capture = (e: MouseEvent) => {
      if (inside(e) || editing(e)) return;
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        const selection = captureSelection();
        setCaptured(selection);
      }, 10);
    };
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.repeat) return;
      if (e.key === 'Escape') {
        setCaptured(null);
        activeRef.current = null;
        setActiveId(null);
        setList(false);
        setPinned(false);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && !editing(e)) {
        if (
          e.key === '.' &&
          current.current.some(
            (passage) =>
              passage.snapshot.id === activeRef.current &&
              ['queued', 'running'].includes(passage.latest.status),
          )
        ) {
          e.preventDefault();
          stopRef.current();
        }
        if (e.key === 'Enter' && !inside(e)) {
          const selection = captureSelection();
          if (selection) {
            e.preventDefault();
            clearTimeout(timeout);
            void explainRef.current(selection);
          }
        }
      }
      if (e.altKey && e.shiftKey && !editing(e)) {
        if (e.code === 'KeyE') {
          const selection = captureSelection();
          if (selection) {
            e.preventDefault();
            clearTimeout(timeout);
            void explainRef.current(selection);
          }
        }
        if (e.code === 'KeyL') {
          e.preventDefault();
          setList((v) => !v);
        }
      }
    };
    const outside = (e: MouseEvent) => {
      if (!inside(e) && !pinned) {
        activeRef.current = null;
        setActiveId(null);
        setCaptured(null);
        setList(false);
      }
    };
    document.addEventListener('mouseup', capture);
    document.addEventListener('keydown', key);
    document.addEventListener('mousedown', outside);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener('mouseup', capture);
      document.removeEventListener('keydown', key);
      document.removeEventListener('mousedown', outside);
    };
  }, [pinned]);
  const attachment = activeId ? markers.current?.attachments.get(activeId) : undefined;
  const unread = passages.filter((p) => p.unread).length;

  return {
    active,
    attachment,
    captured,
    busy,
    recipes,
    recipeChoice,
    defaultRecipeId,
    outputFormat,
    setOutputFormat,
    chooseRecipe(id: string) {
      setRecipeChoice(id);
      setOutputFormat(undefined);
    },
    explain,
    pinned,
    minimum,
    reuse,
    togglePinned: () => setPinned((v) => !v),
    close() {
      activeRef.current = null;
      setActiveId(null);
      setPinned(false);
    },
    action,
    followUpDrafts,
    setFollowUpDrafts,
    loadRuns: async (id: string) =>
      (await sendReadingMessage({ action: 'runs', selectionId: id })).runs,
    passages,
    list,
    open,
    toggleList() {
      setToast(null);
      setList((value) => !value);
    },
    toast,
    dismissToast: () => setToast(null),
    errorsMuted,
    muting,
    muteErrors,
    unread,
    attachmentState: (id: string) => markers.current?.attachments.get(id)?.state,
  };
}
