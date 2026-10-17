import { useCallback, useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Library } from './Library';
import { Settings } from './Settings';
import { Tabs } from './Tabs';
import { useMinimumMode } from './useMinimumMode';
import { PresentationSettings } from './PresentationSettings';

type View = 'history' | 'tabs' | 'settings';
function viewFromHash(): View {
  const hash = location.hash.slice(1);
  return hash === 'tabs' || hash === 'settings' ? hash : 'history';
}
export function Workspace({ popup = false }: { popup?: boolean }) {
  const presentation = useMinimumMode();
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !event.defaultPrevented &&
        !event.isComposing &&
        !event.repeat &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key === ','
      ) {
        event.preventDefault();
        navigate('settings');
      }
    };
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [navigate]);
  return (
    <main className={`shell ${popup ? 'popup' : ''}`} data-minimum={presentation.minimum}>
      <header className="masthead">
        <div className="brand">
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
            ['history', 'History'],
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
      {view === 'history' && (
        <Library compact={popup} refreshKey={readingRevision} minimum={presentation.minimum} />
      )}
      {view === 'tabs' && <Tabs />}
      {view === 'settings' && (
        <div className="stack settings-layout">
          <PresentationSettings preference={presentation} />
          <Settings onDirty={setSettingsDirty} />
        </div>
      )}
    </main>
  );
}
