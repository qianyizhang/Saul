import { useEffect, useState } from 'react';
import { ENABLED_KEY, STATUS_KEY } from '../native/bridge';

export function NativeBridge() {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<{ state: string; error?: string }>({ state: 'disabled' });
  const [copied, setCopied] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    void chrome.storage.local
      .get(ENABLED_KEY)
      .then((data) => setEnabled(data[ENABLED_KEY] === true));
    const readStatus = (value: any) => {
      if (typeof value?.state === 'string') setStatus(value);
    };
    void chrome.storage.session.get(STATUS_KEY).then((data) => readStatus(data[STATUS_KEY]));
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && changes[STATUS_KEY]) readStatus(changes[STATUS_KEY].newValue);
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
  const install = `node native/install.mjs --extension-id ${chrome.runtime.id}`;
  const mcp = 'codex mcp add saul-tabs -- node "$HOME/.saul/bridge/mcp.mjs"';
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
        use the tab organizer below without enabling Codex access.
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
            1. From your Saul checkout, install the host for this extension:
          </p>
          <code className="code">{install}</code>
          <button className="btn" onClick={() => copy('install', install)}>
            {copied === 'install' ? 'Copied install command' : 'Copy install command'}
          </button>
          <p className="small muted">
            2. Use the Codex registration command printed by the installer. For the default
            installation, this also works when Node is on your shell PATH:
          </p>
          <code className="code">{mcp}</code>
          <button className="btn" onClick={() => copy('mcp', mcp)}>
            {copied === 'mcp' ? 'Copied Codex command' : 'Copy Codex command'}
          </button>
          <p className="small muted">
            3. Enable access above, then start a new Codex task or reload its MCP connections. Ask
            Codex to preview a tab sort.
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
