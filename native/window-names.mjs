import { execFile as callbackExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(callbackExecFile);
const script = fileURLToPath(new URL('./window-names.jxa', import.meta.url));

export function createWindowNames({
  browserPid,
  platform = process.platform,
  execFile = execute,
} = {}) {
  let supported;
  const available = async () => {
    if (supported !== undefined) return supported;
    if (platform !== 'darwin') return false;
    if (!Number.isSafeInteger(browserPid) || browserPid <= 0)
      throw new Error(
        'Reload Saul in Chrome to restart its native host before using native window names',
      );
    const { stdout } = await execFile('/bin/ps', ['-p', String(browserPid), '-o', 'comm='], {
      timeout: 3000,
    });
    // Never launch an app or select another Chrome process by its app name.
    supported = /\/(Google Chrome|Google Chrome for Testing)\.app\/Contents\/MacOS\/\1$/.test(
      stdout.trim(),
    );
    return supported;
  };
  const invoke = async (snapshot, action, updates) => {
    const windows = (updates ?? snapshot.windows.map((w) => ({ windowId: w.id }))).map((w) => {
      if (!snapshot.windows.some((x) => x.id === w.windowId))
        throw new Error('Unknown native-name destination');
      return {
        ...w,
        tabIds: snapshot.tabs.filter((t) => t.windowId === w.windowId).map((t) => t.id),
      };
    });
    const { stdout } = await execFile(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', script, JSON.stringify({ browserPid, action, windows })],
      { timeout: 15000, maxBuffer: 1024 * 1024 },
    );
    const names = JSON.parse(stdout);
    if (
      !Array.isArray(names) ||
      names.length !== windows.length ||
      names.some(
        (w, i) =>
          w.windowId !== windows[i].windowId ||
          typeof w.title !== 'string' ||
          w.title.length > 1000,
      )
    )
      throw new Error('Invalid native window-name response');
    return names;
  };
  const failure = (error) => {
    // execFile's error message includes its argv; never expose titles/tab IDs.
    const detail = String(error.stderr || error.message || error)
      .replace(/^Command failed:[\s\S]*/, 'AppleScript command failed')
      .trim();
    if (error.killed || error.signal === 'SIGTERM')
      return 'Native Chrome naming timed out. Inspect any pending Chrome/macOS Automation dialog, then refresh; no automatic retry was made.';
    if (/-1743|-10004|[Nn]ot authorized/.test(detail))
      return `Native Chrome names unavailable. Allow Automation access to Google Chrome for the calling app in macOS System Settings, then refresh. ${detail}`;
    return `Native Chrome names unavailable: ${detail}`;
  };
  return {
    async read(snapshot) {
      try {
        if (!(await available())) return { status: 'unsupported' };
        return { status: 'available', windows: await invoke(snapshot, 'read') };
      } catch (error) {
        return { status: 'unavailable', message: failure(error) };
      }
    },
    async apply(snapshot, windows, dryRun = false) {
      if (!(await available())) return;
      try {
        await invoke(snapshot, dryRun ? 'read' : 'apply', windows);
      } catch (error) {
        throw new Error(failure(error), { cause: error });
      }
    },
  };
}

// Import updates trusted extension metadata, never Chrome names/layout on read.
export function withWindowNames(call, names) {
  return async (name, args = {}) => {
    if (name === 'saul_tabs_list') {
      const snapshot = await call(name, args);
      if (!Array.isArray(snapshot.windows) || !Array.isArray(snapshot.tabs)) return snapshot;
      const result = await names.read(snapshot);
      snapshot.nativeNames = {
        status: result.status,
        ...(result.message ? { message: result.message } : {}),
      };
      if (result.status === 'available') {
        const changed = result.windows.filter(
          (w) => snapshot.windows.find((x) => x.id === w.windowId)?.title !== w.title,
        );
        if (changed.length) await call('saul_windows_label', { windows: changed, dryRun: false });
        for (const window of snapshot.windows)
          window.title = result.windows.find((w) => w.windowId === window.id).title;
      }
      return snapshot;
    }
    if (name === 'saul_windows_label') {
      const snapshot = await call('saul_tabs_list', {});
      await names.apply(snapshot, args.windows, args.dryRun !== false);
    }
    return call(name, args);
  };
}
