import { useEffect, useState } from 'react';
import { ActionLabel } from '../../ui/ActionLabel';
import { SUMMARY_ACTION_ID, SUMMARY_CLOSE_ID } from '../../calls/summary-actions';

export function SettingsShortcuts({ visible }: { visible: boolean }) {
  const [summaryShortcut, setSummaryShortcut] = useState('Loading…');
  const [closeShortcut, setCloseShortcut] = useState('Loading…');
  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      void chrome.commands.getAll().then(
        (commands) => {
          if (!disposed) {
            setCloseShortcut(
              commands.find((command) => command.name === SUMMARY_CLOSE_ID)?.shortcut ||
                'Not assigned',
            );
            setSummaryShortcut(
              commands.find((command) => command.name === SUMMARY_ACTION_ID)?.shortcut ||
                'Not assigned',
            );
          }
        },
        () => {
          if (!disposed) {
            setSummaryShortcut('Unavailable');
            setCloseShortcut('Unavailable');
          }
        },
      );
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      disposed = true;
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return (
    <details hidden={!visible} className="panel shortcuts">
      <summary>Shortcuts</summary>
      <dl>
        <div>
          <dt>Call Saul</dt>
          <dd>{summaryShortcut}</dd>
        </div>
        <div>
          <dt>Close summary panel</dt>
          <dd>{closeShortcut}</dd>
        </div>
        <div>
          <dt>Explain selection</dt>
          <dd>⌘ / Ctrl + Enter</dd>
        </div>
        <div>
          <dt>Stop active explanation</dt>
          <dd>⌘ / Ctrl + .</dd>
        </div>
        <div>
          <dt>Dismiss</dt>
          <dd>Escape</dd>
        </div>
        <div>
          <dt>Settings</dt>
          <dd>⌘ / Ctrl + ,</dd>
        </div>
        <div>
          <dt>Explain selection</dt>
          <dd>Alt + Shift + E</dd>
        </div>
        <div>
          <dt>Page explanations</dt>
          <dd>Alt + Shift + L</dd>
        </div>
      </dl>
      <button
        type="button"
        className="btn quiet"
        onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}
        aria-label="Configure Chrome shortcuts"
        title="Configure Chrome shortcuts"
      >
        <ActionLabel short="Configure" full="Configure Chrome shortcuts" />
      </button>
    </details>
  );
}
