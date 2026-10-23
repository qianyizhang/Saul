import { PAGE_ACCESS_KEY } from '../native/pages';
import { useEffect, useState } from 'react';
import {
  ENABLED_KEY,
  STATUS_KEY,
  isNativeBridgeStatus,
  type NativeBridgeStatus,
} from '../native/bridge';

export function NativeBridge() {
  const [pageEnabled, setPageEnabled] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<NativeBridgeStatus>({ state: 'disabled' });
  const [copied, setCopied] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    void chrome.storage.local.get([ENABLED_KEY, PAGE_ACCESS_KEY]).then((data) => {
      setEnabled(data[ENABLED_KEY] === true);
      setPageEnabled(data[PAGE_ACCESS_KEY] === true);
    });
    const readStatus = (value: unknown) => {
      if (isNativeBridgeStatus(value)) setStatus(value);
    };
    void chrome.storage.session.get(STATUS_KEY).then((data) => readStatus(data[STATUS_KEY]));
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && changes[STATUS_KEY]) readStatus(changes[STATUS_KEY].newValue);
      if (area === 'local' && changes[PAGE_ACCESS_KEY])
        setPageEnabled(changes[PAGE_ACCESS_KEY].newValue === true);
      if (area === 'local' && changes[ENABLED_KEY])
        setEnabled(changes[ENABLED_KEY].newValue === true);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);
  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setError('');
    } catch {
      setError('Could not copy. Select the command and copy it manually.');
    }
  }
  const install = `node scripts/setup.mts --components tabs --extension-id ${chrome.runtime.id}`;
  return (
    <section className="panel stack">
      <label className="toggle">
        <strong>Codex tab access</strong>
        <input
          type="checkbox"
          checked={enabled}
          onChange={async (e) => {
            try {
              await chrome.storage.local.set({ [ENABLED_KEY]: e.target.checked });
              setError('');
            } catch (err) {
              setError(String(err));
            }
          }}
        />
      </label>
      <p className="small muted">
        Let local tools read tab titles and URLs and organize tabs. Incognito is excluded. You can
        use the Window tab without enabling Codex access.
      </p>
      <label className="toggle">
        <strong>Page reading and actions</strong>
        <input
          type="checkbox"
          checked={pageEnabled}
          onChange={async (e) => {
            const next = e.target.checked;
            setPageEnabled(next);
            try {
              await chrome.storage.local.set({ [PAGE_ACCESS_KEY]: next });
              setError('');
            } catch (err) {
              setPageEnabled(!next);
              setError(String(err));
            }
          }}
        />
      </label>
      <p className="small muted">
        Also let connected local tools read visible web page text, click controls, fill text fields,
        and navigate tabs. Clicks may submit forms or change website data. Requires Codex tab
        access.
      </p>
      <div className="row between">
        <span className="badge" role="status">
          {status.state === 'connected'
            ? 'Connected to native host'
            : status.state === 'disabled'
              ? 'Off'
              : status.state === 'connecting'
                ? 'Connecting…'
                : 'Disconnected'}
        </span>
        {enabled && (
          <button
            className="btn"
            onClick={async () => {
              try {
                const r = await chrome.runtime.sendMessage({ type: 'NATIVE_RECONNECT' });
                if (!r?.success) throw new Error(r?.error || 'Reconnect failed');
              } catch (err) {
                setError(String(err));
              }
            }}
          >
            Reconnect
          </button>
        )}
      </div>
      {(error || status.error) && (
        <p className="notice error" role="alert">
          {error || status.error}
        </p>
      )}
      <details>
        <summary>Connect Codex · setup and troubleshooting</summary>
        <div className="stack" style={{ marginTop: 12 }}>
          <p className="small muted">
            1. From the monorepo root, run this command to build and install the tab helper. Add
            --codex only for a new Codex registration. For an existing helper, follow docs/setup.md
            before upgrading:
          </p>
          <code className="code">{install}</code>
          <button className="btn" onClick={() => copy('install', install)}>
            {copied === 'install' ? 'Copied setup command' : 'Copy setup command'}
          </button>
          <p className="small muted">
            2. Enable access above and choose Reconnect. From the monorepo root, run pnpm --dir
            apps/saul verify:connection to check the connection.
          </p>
          <p className="small muted">
            3. After current work finishes, fully quit and reopen Codex to load the installed tools.
            Ask Codex to preview a tab sort.
          </p>
          <p className="small muted">
            Host missing? Check that the installed extension ID matches this one. After updating
            Node or the bridge, rerun the installer and reconnect. With multiple browser profiles,
            choose a session explicitly.
          </p>
          <code className="code">Extension ID: {chrome.runtime.id}</code>
          <p className="small muted">
            Programs running as your OS user can access the bridge while enabled. Turning access off
            stops new requests.
          </p>
        </div>
      </details>
    </section>
  );
}
