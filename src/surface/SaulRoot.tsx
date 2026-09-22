import { useEffect, useState, useRef } from 'react';
import { captureSelection, buildResolvedContext } from '../capture/selection';
import { request } from '../storage/client';
import type { ReadingRequest, ReadingResult } from '../contracts/reading';
import type { Passage } from '../types/storage';
import { PassageMarkers } from '../reading/markers';
import { FloatingTrigger } from './FloatingTrigger';
import { ExplanationCard, runLabel } from './ExplanationCard';
const read = (message: ReadingRequest) =>
  request<ReadingResult>({ target: 'saul-reading', message });
type Captured = NonNullable<ReturnType<typeof captureSelection>>;
export function SaulRoot() {
  const [passages, setPassages] = useState<Passage[]>([]),
    [captured, setCaptured] = useState<Captured | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null),
    [pinned, setPinned] = useState(false),
    [list, setList] = useState(false);
  const [busy, setBusy] = useState(false),
    [toast, setToast] = useState<{ text: string; id?: string; error?: boolean } | null>(null);
  const [, redraw] = useState(0);
  const [errorsMuted, setErrorsMuted] = useState<boolean | null>(null);
  const [muting, setMuting] = useState(false);
  async function muteErrors() {
    if (muting) return;
    setMuting(true);
    try {
      await read({ action: 'mute-errors', muted: true });
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
  current.current = passages;
  activeRef.current = activeId;
  const active = passages.find((p) => p.snapshot.id === activeId);
  function open(id: string, scroll = false) {
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
    markers.current?.set(passages);
  }, [passages]);
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
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    const announced = new Set<string>();
    const summary = () => {
      if (document.visibilityState !== 'visible') return;
      const unread = current.current.filter((p) => p.unread && p.snapshot.id !== activeRef.current);
      if (unread.length)
        setToast({
          text: unread.length === 1 ? 'Explanation ready' : `${unread.length} explanations ready`,
          id: unread[0]!.snapshot.id,
        });
    };
    function refresh(): Promise<void> {
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
        const url = route;
        try {
          const result = await read({ action: 'list' });
          if (disposed) return;
          if (url !== location.href) {
            again = true;
            continue;
          }
          const next = result.passages || [];
          current.current = next;
          markers.current?.set(next);
          setPassages(next);
          if (next.some((p) => p.unread && p.completed && !announced.has(p.completed.id))) {
            for (const p of next) if (p.completed) announced.add(p.completed.id);
            clearTimeout(readyTimer);
            readyTimer = setTimeout(summary, 600);
          }
        } catch (error) {
          if (!disposed) setToast({ text: (error as Error).message, error: true });
        }
      } while (again && !disposed);
    }
    refreshRef.current = refresh;
    function connectPort() {
      if (disposed) return;
      const connected = chrome.runtime.connect({ name: 'saul-reading' });
      port = connected;
      connected.onMessage.addListener((message) => {
        if (message.type === 'notifications') {
          setErrorsMuted(message.muted === true);
          // Never resurrect a previously suppressed error when unmuting.
          if (preferenceReceived || message.muted === true)
            setToast((current) => (current?.error ? null : current));
          preferenceReceived = true;
        } else void refresh();
      });
      connected.onDisconnect.addListener(() => {
        if (!disposed && port === connected) reconnect = setTimeout(connect, 1000);
      });
    }
    function connect() {
      connectPort();
      void refresh();
    }
    function syncRoute() {
      if (route === location.href) return false;
      route = location.href;
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
      if (syncRoute()) void refresh();
    }, 750);
    return () => {
      disposed = true;
      clearInterval(routeTimer);
      clearTimeout(reconnect);
      clearTimeout(readyTimer);
      port?.disconnect();
      document.removeEventListener('visibilitychange', visible);
      chrome.runtime.onMessage.removeListener(source);
    };
  }, []);
  useEffect(() => {
    const run = active?.completed;
    if (run && run.viewedAt === undefined)
      void read({ action: 'view', selectionId: active!.snapshot.id, runId: run.id })
        .then(() => refreshRef.current())
        .catch((e) => setToast({ text: e.message, error: true }));
  }, [active?.snapshot.id, active?.completed?.id, active?.completed?.viewedAt]);
  async function action(message: ReadingRequest) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await read(message);
      await refreshRef.current();
      return result;
    } catch (error) {
      setToast({ text: (error as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }
  async function explain(selection: Captured | null = captured) {
    if (!selection || busy) return;
    const known = passages.find((p) => {
      const attachment = markers.current?.attachments.get(p.snapshot.id);
      return (
        attachment?.state === 'attached' &&
        selection.range.compareBoundaryPoints(Range.START_TO_START, attachment.range) === 0 &&
        selection.range.compareBoundaryPoints(Range.END_TO_END, attachment.range) === 0
      );
    });
    if (known) {
      open(known.snapshot.id);
      return;
    }
    setBusy(true);
    try {
      const { policy } = await read({ action: 'policy' });
      if (!policy) throw new Error('Could not load reading preferences.');
      if (location.href !== selection.snapshot.page.url)
        throw new Error('The page changed. Select the passage again.');
      const result = await read({
        action: 'submit',
        submissionId: selection.snapshot.id,
        snapshot: selection.snapshot,
        context: buildResolvedContext(selection.snapshot, selection.range, policy),
      });
      if (location.href !== selection.snapshot.page.url) return;
      setCaptured(null);
      window.getSelection()?.removeAllRanges();
      await refreshRef.current();
      if (result.reused && result.passageId) open(result.passageId);
      else setToast({ text: 'Queued · keep reading', id: result.passageId });
    } catch (error) {
      setToast({ text: (error as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }
  const explainRef = useRef(explain);
  explainRef.current = explain;
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const inside = (e: Event) =>
      e.composedPath().some((n) => n instanceof Element && n.tagName.toLowerCase() === 'saul-root');
    const editing = (e: Event) =>
      e.target instanceof Element && !!e.target.closest('input,textarea,[contenteditable]');
    const capture = (e: MouseEvent) => {
      if (inside(e) || editing(e)) return;
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        const selection = captureSelection();
        setCaptured(selection);
      }, 10);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCaptured(null);
        setActiveId(null);
        setList(false);
        setPinned(false);
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
  return (
    <>
      {captured && !busy && (
        <FloatingTrigger range={captured.range} onTrigger={() => void explain()} />
      )}
      {active && (
        <ExplanationCard
          key={active.snapshot.id}
          range={attachment?.state === 'attached' ? attachment.range : null}
          passage={active}
          pinned={pinned}
          busy={busy}
          onPin={() => setPinned((v) => !v)}
          onClose={() => {
            setActiveId(null);
            setPinned(false);
          }}
          onStop={() => void action({ action: 'stop', selectionId: active.snapshot.id })}
          onBookmark={() =>
            void action({
              action: 'bookmark',
              selectionId: active.snapshot.id,
              bookmarked: !active.bookmarked,
            })
          }
          onRetry={(instruction) =>
            void action({
              action: 'regenerate',
              submissionId: crypto.randomUUID(),
              selectionId: active.snapshot.id,
              instruction,
            })
          }
          loadRuns={async () =>
            (await read({ action: 'runs', selectionId: active.snapshot.id })).runs || []
          }
        />
      )}
      {(passages.length > 0 || list) && (
        <div
          className="fixed bottom-3 right-3 font-sans text-xs text-slate-600"
          style={{ zIndex: 2147483646 }}
        >
          {list && (
            <section
              aria-label="Page explanations"
              className="mb-2 w-72 max-h-80 overflow-auto bg-white border border-slate-200 rounded-lg shadow-lg p-3"
            >
              <h2 className="font-semibold mb-2">On this page</h2>
              {!passages.length && <p>No explanations yet.</p>}
              {passages.map((p) => (
                <button
                  className="block text-left w-full p-2 rounded hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-indigo-600"
                  key={p.snapshot.id}
                  onClick={() => open(p.snapshot.id, true)}
                >
                  <span className="block truncate font-medium">{p.snapshot.text}</span>
                  <span>
                    {p.unread ? 'New · ' : ''}
                    {runLabel(p.latest.status)}
                    {markers.current?.attachments.get(p.snapshot.id)?.state !== 'attached'
                      ? ' · location unavailable'
                      : ''}
                  </span>
                </button>
              ))}
            </section>
          )}
          <button
            className="bg-white/95 border border-slate-200 rounded-full px-3 py-1.5 shadow-sm"
            aria-label="Page explanations"
            aria-expanded={list}
            onClick={() => {
              setToast(null);
              setList((v) => !v);
            }}
          >
            Saul · {passages.length}
            {unread ? ` · ${unread} new` : ''}
          </button>
        </div>
      )}
      {toast && !list && (!toast.error || errorsMuted === false) && (
        <div
          role={toast.error ? 'alert' : 'status'}
          className="fixed bottom-14 right-3 max-w-xs bg-white text-slate-700 font-sans text-sm border border-slate-200 rounded-lg shadow-lg px-3 py-2"
          style={{ zIndex: 2147483647 }}
        >
          <span>{toast.text}</span>
          {toast.error && (
            <button
              className="ml-3 text-indigo-700 underline"
              aria-label="Mute error notifications"
              title="Mute error toasts on all pages. Turn them back on in Saul Settings."
              disabled={muting}
              onClick={() => void muteErrors()}
            >
              {muting ? 'Muting…' : 'Mute'}
            </button>
          )}
          {toast.id && (
            <button
              className="ml-3 text-indigo-700 underline"
              onClick={() => open(toast.id!, true)}
            >
              View
            </button>
          )}
          <button
            className="ml-3 text-slate-400"
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
