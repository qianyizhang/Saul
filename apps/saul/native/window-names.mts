import { organizePermission } from '../shared/protocol/local-access.mts';
import type { TabSnapshot } from '../shared/protocol/protocol.mts';
import type { WindowNameReply, WindowNameRequest } from './window-name-messages.mts';
export interface NativeWindowName {
  windowId: number;
  title: string;
  expectedTitle?: string;
}
export type NativeNames =
  | { status: 'available'; windows: NativeWindowName[] }
  | { status: 'unavailable' | 'unsupported'; message?: string };
export interface WindowNames {
  read(snapshot: TabSnapshot): Promise<NativeNames>;
  apply(snapshot: TabSnapshot, windows: NativeWindowName[], dryRun?: boolean): Promise<void>;
}

import { isRecord } from '../shared/model/value.mts';
import { validateCall } from '../shared/protocol/protocol.mts';
import { validateToolResult } from '../shared/protocol/results.mts';
import { execFile as callbackExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(callbackExecFile);
const script = fileURLToPath(new URL('./window-names.jxa', import.meta.url));

export function createWindowNames({
  browserPid,
  platform = process.platform,
  execFile = execute,
}: {
  browserPid?: number;
  platform?: string;
  execFile?: (
    file: string,
    args: string[],
    options: import('node:child_process').ExecFileOptions,
  ) => Promise<{ stdout: string }>;
} = {}): WindowNames {
  let supported: boolean | undefined;
  function connectedPid(): number {
    if (browserPid === undefined || !Number.isSafeInteger(browserPid) || browserPid <= 0)
      throw new Error(
        'Reload Saul in Chrome to restart its native host before using native window names',
      );
    return browserPid;
  }
  const available = async () => {
    if (supported !== undefined) return supported;
    if (platform !== 'darwin') return false;
    const browserPid = connectedPid();
    const { stdout } = await execFile('/bin/ps', ['-p', String(browserPid), '-o', 'comm='], {
      timeout: 3000,
    });
    // Never launch an app or select another Chrome process by its app name.
    supported = /\/(Google Chrome|Google Chrome for Testing)\.app\/Contents\/MacOS\/\1$/.test(
      stdout.trim(),
    );
    return supported;
  };
  const invoke = async (
    snapshot: TabSnapshot,
    command:
      | { action: 'read'; updates?: NativeWindowName[] }
      | { action: 'apply'; updates: NativeWindowName[] },
  ): Promise<NativeWindowName[]> => {
    const browserPid = connectedPid();
    const withTabs = <T extends { windowId: number }>(w: T) => {
      if (!snapshot.windows.some((x) => x.id === w.windowId))
        throw new Error('Unknown native-name destination');
      return {
        ...w,
        tabIds: snapshot.tabs.filter((t) => t.windowId === w.windowId).map((t) => t.id),
      };
    };
    const request: WindowNameRequest =
      command.action === 'apply'
        ? { browserPid, action: 'apply', windows: command.updates.map(withTabs) }
        : {
            browserPid,
            action: 'read',
            windows: (command.updates ?? snapshot.windows.map((w) => ({ windowId: w.id }))).map(
              withTabs,
            ),
          };
    const { windows } = request;
    const { stdout } = await execFile(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', script, JSON.stringify(request)],
      { timeout: 15000, maxBuffer: 1024 * 1024 },
    );
    const names: unknown = JSON.parse(stdout);
    if (
      !Array.isArray(names) ||
      names.length !== windows.length ||
      !names.every(
        (w: unknown, i): w is WindowNameReply[number] =>
          isRecord(w) &&
          w.windowId === windows[i]!.windowId &&
          typeof w.title === 'string' &&
          w.title.length <= 1000,
      )
    )
      throw new Error('Invalid native window-name response');
    return names;
  };
  const failure = (cause: unknown) => {
    const error = isRecord(cause) ? cause : { message: String(cause) };
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
        return { status: 'available', windows: await invoke(snapshot, { action: 'read' }) };
      } catch (error) {
        return { status: 'unavailable', message: failure(error) };
      }
    },
    async apply(snapshot, windows, dryRun = false) {
      if (!(await available())) return;
      try {
        await invoke(snapshot, { action: dryRun ? 'read' : 'apply', updates: windows });
      } catch (error) {
        throw new Error(failure(error), { cause: error });
      }
    },
  };
}

// Import updates trusted extension metadata, never Chrome names/layout on read.
export function withWindowNames(
  call: (name: string, args?: Record<string, unknown>) => Promise<unknown>,
  names: WindowNames,
) {
  return async (name: string, args: Record<string, unknown> = {}) => {
    if (name === 'saul_tabs_list') {
      const snapshot = validateToolResult('saul_tabs_list', await call(name, args));
      if (!Array.isArray(snapshot.windows) || !Array.isArray(snapshot.tabs)) return snapshot;
      const result = await names.read(snapshot);
      snapshot.nativeNames = {
        status: result.status,
        ...('message' in result && result.message ? { message: result.message } : {}),
      };
      if (result.status === 'available') {
        const changed = result.windows.filter(
          (w) => snapshot.windows.find((x) => x.id === w.windowId)?.title !== w.title,
        );
        if (changed.length && snapshot.localAccess?.tabs !== 'read')
          await call('saul_windows_label', { windows: changed, dryRun: false });
        for (const window of snapshot.windows)
          window.title = result.windows.find((w) => w.windowId === window.id)!.title;
      }
      return snapshot;
    }
    if (name === 'saul_windows_label') {
      const snapshot = validateToolResult('saul_tabs_list', await call('saul_tabs_list', {}));
      const input = validateCall('saul_windows_label', args);
      if (input.dryRun === false && snapshot.localAccess?.tabs === 'read')
        throw new Error(organizePermission);
      await names.apply(snapshot, input.windows, input.dryRun !== false);
    }
    return call(name, args);
  };
}
