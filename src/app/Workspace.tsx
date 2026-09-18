import { useCallback, useEffect, useState } from 'react';
import { BookOpen, ExternalLink } from 'lucide-react';
import { useRefreshOnFocus } from './useRefreshOnFocus';
import { Library } from './Library';
import { Settings } from './Settings';
import { Tabs } from './Tabs';
import { getSettings } from '../storage/settings';
import { fetchHistory } from '../storage/client';
import { plainExplanation } from './format';
import type { HistoryItem } from '../types/storage';
type View = 'reading' | 'history' | 'tabs' | 'settings';
function viewFromHash(): View {
  const hash = location.hash.slice(1);
  return hash === 'history' || hash === 'tabs' || hash === 'settings' ? hash : 'reading';
}
export function Workspace({ popup = false }: { popup?: boolean }) {
  const [view, setView] = useState<View>(viewFromHash);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [model, setModel] = useState('');
  const [recent, setRecent] = useState<HistoryItem[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, refresh] = useState(0);
  useRefreshOnFocus(useCallback(() => refresh((n) => n + 1), []));
  useEffect(() => {
    if (view !== 'reading') return;
    let cancelled = false;
    setError('');
    setLoading(true);
    Promise.all([getSettings(), fetchHistory(3)])
      .then(([settings, history]) => {
        if (cancelled) return;
        setModel(
          settings.activeProvider === 'chrome-ai'
            ? 'Chrome on-device AI'
            : settings.openaiCompatible.model,
        );
        setRecent(history);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view, revision]);
  const navigate = useCallback(
    (next: View) => {
      if (next === view) return;
      if (settingsDirty && !window.confirm('Discard unsaved settings?')) {
        history.replaceState(null, '', `#${view}`);
        return;
      }
      setSettingsDirty(false);
      setView(next);
      location.hash = next;
    },
    [view, settingsDirty],
  );
  useEffect(() => {
    const onHashChange = () => navigate(viewFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [navigate]);
  return (
    <main className={`shell ${popup ? 'popup' : ''}`}>
      <header className="masthead">
        <div className="brand">
          <span className="brand-mark">
            <BookOpen size={21} />
          </span>
          <div>
            <h1>Saul</h1>
            <span className="small muted">Read, understand, organize.</span>
          </div>
        </div>
        {popup && (
          <a
            className="btn icon"
            aria-label="Open full workspace"
            title="Open full workspace"
            href={chrome.runtime.getURL(`/library.html#${view}`)}
            target="_blank"
          >
            <ExternalLink size={16} />
          </a>
        )}
      </header>
      <nav className="nav" aria-label="Main navigation">
        <button
          aria-current={view === 'reading' || view === 'history' ? 'page' : undefined}
          onClick={() => navigate('reading')}
        >
          Reading
        </button>
        <button
          aria-current={view === 'tabs' ? 'page' : undefined}
          onClick={() => navigate('tabs')}
        >
          Tabs
        </button>
        <button
          aria-current={view === 'settings' ? 'page' : undefined}
          onClick={() => navigate('settings')}
        >
          Settings
        </button>
      </nav>
      {view === 'reading' && (
        <div className="stack">
          <section className="panel">
            <h2 className="hero-title">
              Keep your place.
              <br />
              Understand more.
            </h2>
            <p className="muted">
              Select text on a webpage, then choose Explain. Your explanations save here
              automatically.
            </p>
            <p className="small muted">
              Shortcut: Alt+Shift+E · Model: {model || 'Choose in Settings'}
            </p>
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn primary" onClick={() => navigate('history')}>
                Reading history
              </button>
              {popup && (
                <a
                  className="btn"
                  href={chrome.runtime.getURL('/library.html#history')}
                  target="_blank"
                >
                  Open library
                </a>
              )}
            </div>
          </section>
          <div className="row between">
            <h2 style={{ fontSize: 16, margin: 0 }}>Recent reading</h2>
            <span className="small muted">On this device</span>
          </div>
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          {loading ? (
            <p role="status" className="muted">
              Loading recent reading…
            </p>
          ) : !error && recent.length ? (
            recent.map((item) => (
              <button
                className="history-entry"
                style={{ textAlign: 'left' }}
                key={item.selectionId}
                onClick={() => navigate('history')}
              >
                <strong>{item.selectedText}</strong>
                <p className="small muted">{plainExplanation(item.responseRaw).slice(0, 150)}</p>
                <span className="small muted">{item.pageTitle}</span>
              </button>
            ))
          ) : (
            !error && <p className="empty muted">Your first explanation starts with a highlight.</p>
          )}
        </div>
      )}
      {view === 'history' && <Library compact={popup} />}
      {view === 'tabs' && <Tabs />}
      {view === 'settings' && (
        <Settings onDirty={setSettingsDirty} onSaved={() => refresh((n) => n + 1)} />
      )}
      <footer className="footer">
        History stays on this device. Your chosen model receives only the context used for an
        explanation.
      </footer>
    </main>
  );
}
