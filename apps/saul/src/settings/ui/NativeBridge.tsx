import { useEffect, useState } from 'react';
import { ControlIcon } from '../../ui/ControlIcon';
import { ActionLabel } from '../../ui/ActionLabel';
import { accessLevel } from '../../../shared/protocol/local-access.mts';
import { STATUS_KEY, isNativeBridgeStatus, type NativeBridgeStatus } from '../../native/bridge';
import {
  localAccessKeys,
  isLocalAccessChange,
  readLocalAccess,
  type LocalAccessPreferences,
} from '../../native/local-access';

const permissions = [
  {
    key: 'pages',
    name: 'Pages',
    cue: 'Write can change sites and start summaries',
    description:
      'Read shows live page content and allows previews. Write also allows clicks, fills, navigation and new Tab board summaries. Clicks can change site data and summaries can send page content to your provider.',
  },
  {
    key: 'annotations',
    name: 'Annotations',
    cue: 'Read includes saved screenshots',
    description:
      'Read shows saved notes and screenshots within the requested scope. Write also allows adding, editing and removing saved notes.',
  },
] as const;

export function NativeBridge() {
  const [access, setAccess] = useState<LocalAccessPreferences>();
  const [status, setStatus] = useState<NativeBridgeStatus>({ state: 'disabled' });
  const [copied, setCopied] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    let accessRevision = 0;
    let statusRevision = 0;
    const readStatus = (value: unknown) => {
      if (active && isNativeBridgeStatus(value)) setStatus(value);
    };
    const refresh = () => {
      const revision = ++accessRevision;
      void readLocalAccess()
        .then((value) => {
          if (active && revision === accessRevision) setAccess(value);
        })
        .catch((cause) => {
          if (active && revision === accessRevision) setError(String(cause));
        });
    };
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && changes[STATUS_KEY]) {
        statusRevision++;
        readStatus(changes[STATUS_KEY].newValue);
      }
      if (area === 'local' && isLocalAccessChange(changes)) refresh();
    };
    chrome.storage.onChanged.addListener(listener);
    const revision = statusRevision;
    void chrome.storage.session.get(STATUS_KEY).then(
      (data) => {
        if (revision === statusRevision) readStatus(data[STATUS_KEY]);
      },
      (cause) => {
        if (active && revision === statusRevision) setError(String(cause));
      },
    );
    refresh();
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  async function save<K extends keyof LocalAccessPreferences>(
    key: K,
    value: LocalAccessPreferences[K],
  ) {
    const before = access;
    if (!before) return;
    setAccess({ ...before, [key]: value });
    setSaving(true);
    try {
      await chrome.storage.local.set({ [localAccessKeys[key]]: value });
      setError('');
    } catch (cause) {
      setAccess(await readLocalAccess().catch(() => before));
      setError(String(cause));
    } finally {
      setSaving(false);
    }
  }

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
        <span>
          <strong>Local tool access</strong>
          <span className="small muted minimum-only" aria-hidden="true">
            {' · Local programs can read tab titles and URLs'}
          </span>
        </span>
        <input
          type="checkbox"
          aria-describedby="local-tool-access-effects"
          checked={access?.enabled ?? false}
          disabled={!access || saving}
          onChange={(event) => void save('enabled', event.target.checked)}
        />
      </label>
      <p id="local-tool-access-effects" className="small standard-only">
        The CLI, Codex and other programs under your OS user can read tab titles, URLs, windows and
        groups. Incognito tabs are excluded. Saul’s Window view works independently.
      </p>
      <fieldset className="stack settings-fields" disabled={!access?.enabled || saving}>
        <section className="stack" aria-labelledby="local-tools-tabs">
          <strong id="local-tools-tabs">Tabs</strong>
          <label className="toggle">
            Organize tabs and windows
            <input
              type="checkbox"
              checked={access?.organize ?? false}
              onChange={(event) => void save('organize', event.target.checked)}
            />
          </label>
        </section>
        {permissions.map(({ key, name, cue, description }) => (
          <div key={key} className="stack">
            <label className="toggle">
              <span>
                <strong>{name}</strong>
                <span className="small muted minimum-only" aria-hidden="true">{` · ${cue}`}</span>
              </span>
              <select
                value={access?.[key] ?? 'off'}
                aria-describedby={`local-tools-${key}`}
                onChange={(event) => void save(key, accessLevel.parse(event.target.value))}
              >
                <option value="off">Off</option>
                <option value="read">Read</option>
                <option value="write">Write</option>
              </select>
            </label>
            <p id={`local-tools-${key}`} className="small standard-only">
              {description}
            </p>
          </div>
        ))}
      </fieldset>
      <div className="row between">
        <span className="badge" role="status">
          {status.state === 'connected'
            ? 'Connected to native host'
            : status.state === 'disabled'
              ? 'Bridge off'
              : status.state === 'connecting'
                ? 'Connecting…'
                : 'Disconnected'}
        </span>
        {access?.enabled && (
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
        <summary
          aria-label="Local tool setup and diagnostics"
          title="Local tool setup and diagnostics"
        >
          <ActionLabel short="Tool setup" full="Local tool setup and diagnostics" />
        </summary>
        <div className="stack" style={{ marginTop: 12 }}>
          <p className="small muted standard-only">
            1. From the monorepo root, run this command to build and install the tab helper. Add
            --codex only for a new Codex registration. For an existing helper, follow docs/setup.md
            before upgrading:
          </p>
          <code className="code">{install}</code>
          <button
            className="btn"
            onClick={() => copy('install', install)}
            aria-label={copied === 'install' ? 'Copied setup command' : 'Copy setup command'}
            title="Copy setup command"
          >
            <ControlIcon symbol={copied === 'install' ? 'copied' : 'copy'} />
          </button>
          <p className="small muted standard-only">
            2. Enable Local tool access above. Use Reconnect if the helper was just installed and
            access was already on. From the monorepo root, run pnpm --dir apps/saul
            verify:connection to check the connection.
          </p>
          <p className="small muted standard-only">
            3. After current work finishes, fully quit and reopen Codex to load the installed tools.
            Ask Codex to preview a tab sort.
          </p>
          <p className="small muted standard-only">
            Host missing? Check that the installed extension ID matches this one. After updating
            Node or the bridge, rerun the installer and reconnect. With multiple browser profiles,
            choose a session explicitly.
          </p>
          <code className="code">Extension ID: {chrome.runtime.id}</code>
          <p className="small muted standard-only">
            Programs running as your OS user can access the bridge while enabled. Turning access off
            stops new requests.
          </p>
        </div>
      </details>
    </section>
  );
}
