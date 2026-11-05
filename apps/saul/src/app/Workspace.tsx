import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Library } from './Library';
import { Settings } from './Settings';
import { Tabs } from './Tabs';
import { SummaryHistory, SummaryReader } from './Summaries';
import { useMinimumMode } from './useMinimumMode';
import { PresentationSettings } from './PresentationSettings';
import { NotificationSettings } from './NotificationSettings';
import { SETTINGS_SECTIONS, type SettingsSection } from './settings-sections';

type View = 'history' | 'tabs' | 'settings' | 'summaries' | 'summary';
function viewFromHash(): View {
  const hash = location.hash.slice(1);
  if (hash.startsWith('summary/')) return 'summary';
  return hash === 'tabs' || hash === 'settings' || hash === 'summaries' ? hash : 'history';
}
export function Workspace({ popup = false }: { popup?: boolean }) {
  const presentation = useMinimumMode();
  const [route, setRoute] = useState(location.hash);
  const [view, setView] = useState<View>(viewFromHash);
  const settingsDirty = useRef(false);
  const markSettingsDirty = useCallback((dirty: boolean) => {
    settingsDirty.current = dirty;
  }, []);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('overview');
  useEffect(() => {
    const labels: Record<View, string> = {
      history: 'History',
      tabs: 'Window',
      settings: 'Settings',
      summaries: 'Summaries',
      summary: 'Summary',
    };
    document.title = 'Saul · ' + labels[view];
  }, [view]);
  const [readingRevision, refreshReading] = useState(0);
  const navigate = useCallback(
    (next: View) => {
      if (next === view) return;
      if (settingsDirty.current && !window.confirm('Discard unsaved settings?')) {
        history.replaceState(null, '', `#${view}`);
        return;
      }
      settingsDirty.current = false;
      setView(next);
      if (next !== 'summary') location.hash = next;
      window.scrollTo(0, 0);
    },
    [view],
  );
  useEffect(() => {
    const onHashChange = () => {
      setRoute(location.hash);
      navigate(viewFromHash());
    };
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
    <main
      className={`shell ${popup ? 'popup' : ''} ${view === 'settings' ? 'settings-shell' : ''}`}
      data-minimum={presentation.minimum}
    >
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
            ['tabs', 'Window'],
            ['settings', 'Settings'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            aria-current={
              view === id || (id === 'history' && ['summaries', 'summary'].includes(view))
                ? 'page'
                : undefined
            }
            onClick={() => {
              if (id === 'history') refreshReading((n) => n + 1);
              navigate(id);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {['history', 'summaries'].includes(view) && (
        <nav className="history-kinds" aria-label="History type">
          <button aria-pressed={view === 'history'} onClick={() => navigate('history')}>
            Passages
          </button>
          <button aria-pressed={view === 'summaries'} onClick={() => navigate('summaries')}>
            Summaries
          </button>
        </nav>
      )}
      {view === 'summaries' && <SummaryHistory />}
      {view === 'summary' && <SummaryReader key={route.split('?')[0]} route={route} />}
      {view === 'history' && (
        <Library compact={popup} refreshKey={readingRevision} minimum={presentation.minimum} />
      )}
      {view === 'tabs' && <Tabs />}
      {view === 'settings' && (
        <div className="settings-workspace">
          <nav className="settings-navigation" aria-label="Settings sections">
            {SETTINGS_SECTIONS.map(([id, label]) => (
              <button
                type="button"
                key={id}
                aria-current={settingsSection === id ? 'page' : undefined}
                onClick={() => setSettingsSection(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="settings-content">
            <section
              hidden={settingsSection !== 'preferences'}
              className="panel settings-section"
              aria-label="Preferences"
            >
              <h3 className="view-title">Preferences</h3>
              <p className="small muted standard-only">Saves immediately.</p>
              <PresentationSettings preference={presentation} />
              <NotificationSettings />
            </section>
            <Settings
              onDirty={markSettingsDirty}
              section={settingsSection}
              onSectionChange={setSettingsSection}
            />
          </div>
        </div>
      )}
    </main>
  );
}
