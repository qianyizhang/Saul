import { useCallback, useEffect, useState } from 'react';
import { BookOpen, ExternalLink } from 'lucide-react';
import { Library } from './Library';
import { Settings } from './Settings';
import { Tabs } from './Tabs';

type View = 'history' | 'tabs' | 'settings';
function viewFromHash(): View {
  const hash = location.hash.slice(1);
  return hash === 'tabs' || hash === 'settings' ? hash : 'history';
}
export function Workspace({ popup = false }: { popup?: boolean }) {
  const [view, setView] = useState<View>(viewFromHash);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [readingRevision, refreshReading] = useState(0);
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
      window.scrollTo(0, 0);
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
            <BookOpen size={20} />
          </span>
          <h1>Saul</h1>
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
        {(
          [
            ['history', 'Reading history'],
            ['tabs', 'Tabs'],
            ['settings', 'Settings'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            aria-current={view === id ? 'page' : undefined}
            onClick={() => {
              if (id === 'history') refreshReading((n) => n + 1);
              navigate(id);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {view === 'history' && <Library compact={popup} refreshKey={readingRevision} />}
      {view === 'tabs' && <Tabs />}
      {view === 'settings' && <Settings onDirty={setSettingsDirty} />}
      <footer className="footer">
        Saved on this device · Context is sent to your chosen model.
      </footer>
    </main>
  );
}
