import { useCallback, useEffect, useState } from 'react';
import { SummaryHistory, SummaryReader } from './Summaries';
import { closeSummaryPanel, summaryPanelKey, summaryPanelRoute } from '../digest/panel';

export function SummaryPanel() {
  const [route, setRoute] = useState<string>();
  const [error, setError] = useState('');
  const [windowId, setWindowId] = useState<number>();
  const close = () => {
    if (windowId !== undefined)
      void closeSummaryPanel(windowId).catch((e: Error) => setError(e.message));
  };
  const resolved = useCallback(
    async (id: string) => {
      if (windowId === undefined) throw new Error('The summary window is unavailable.');
      await chrome.storage.session.set({
        [summaryPanelKey(windowId)]: '#summary/' + encodeURIComponent(id),
      });
    },
    [windowId],
  );
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        !event.isComposing &&
        event.key.toLowerCase() === 'w'
      ) {
        event.preventDefault();
        if (windowId !== undefined)
          void closeSummaryPanel(windowId).catch((e: Error) => setError(e.message));
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [windowId]);
  useEffect(() => {
    let disposed = false;
    let key: string | undefined;
    let revision = 0;
    let displayed = false;
    const show = (value: unknown) => {
      const next = summaryPanelRoute(value);
      displayed = true;
      setError('');
      setRoute(next);
      history.replaceState(null, '', next);
    };
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'session' || !key || !(key in changes)) return;
      revision++;
      // The reader already shows a resolved result. Persist its real ID without
      // remounting it and discarding the upfront reuse/comparison notice.
      if (displayed && changes[key]!.newValue === location.hash) return;
      show(changes[key]!.newValue);
    };
    const navigate = () => {
      show(location.hash);
      if (key)
        void chrome.storage.session
          .set({ [key]: summaryPanelRoute(location.hash) })
          .catch((e: Error) => {
            if (!disposed) setError(e.message);
          });
    };
    chrome.storage.onChanged.addListener(changed);
    window.addEventListener('hashchange', navigate);
    void (async () => {
      const currentWindow = await chrome.windows.getCurrent();
      if (disposed) return;
      if (currentWindow.id === undefined) throw new Error('The summary window is unavailable.');
      setWindowId(currentWindow.id);
      key = summaryPanelKey(currentWindow.id);
      const before = revision;
      const stored = await chrome.storage.session.get(key);
      if (!disposed && before === revision) show(stored[key]);
    })().catch((e: Error) => {
      if (!disposed) setError(e.message);
    });
    return () => {
      disposed = true;
      chrome.storage.onChanged.removeListener(changed);
      window.removeEventListener('hashchange', navigate);
    };
  }, []);
  return (
    <main className="shell summary-panel">
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {!route && !error && <p role="status">Loading summary…</p>}
      {route?.startsWith('#summary/') ? (
        <SummaryReader
          key={route.split('?')[0]}
          route={route}
          sidePanel
          onClose={close}
          onResolved={resolved}
        />
      ) : route ? (
        <section className="stack">
          <div className="row between">
            <h2>Saved summaries</h2>
            <button className="btn quiet" onClick={close} aria-label="Close summary panel">
              Close
            </button>
          </div>
          <SummaryHistory
            onOpen={(id) => {
              location.hash = 'summary/' + encodeURIComponent(id);
            }}
          />
        </section>
      ) : null}
    </main>
  );
}
