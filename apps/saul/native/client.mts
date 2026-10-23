import { isRecord } from './value.mts';
import { isSession, validateToolResult } from './results.mts';
import type { ToolName, ToolArgs, ToolResults } from './protocol.mts';
import type { WindowNames } from './window-names.mts';
import { errorCode } from './value.mts';
import net from 'node:net';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runtimeDirectory, lineDecoder } from './transport.mts';
import { validateCall, MAX_MESSAGE } from './protocol.mts';
import { createWindowNames, withWindowNames } from './window-names.mts';

const nativeNames = new Map<string, WindowNames>();

export function request(
  session: string,
  method: string,
  params: Record<string, unknown> = {},
  timeout = 35000,
) {
  if (!/^[a-f0-9]{16}$/.test(session)) throw new Error('Invalid session ID');
  return new Promise<unknown>((resolve, reject) => {
    const socket = net.createConnection(join(runtimeDirectory(), `${session}.sock`));
    const id = randomUUID();
    let settled = false;
    const finish = (error: unknown, value?: unknown) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const decode = lineDecoder((message) => {
      if (!isRecord(message)) {
        finish(new Error('Invalid bridge response'));
        return;
      }
      const remoteError =
        isRecord(message.error) && typeof message.error.message === 'string'
          ? message.error.message
          : undefined;
      if (message.id !== id) {
        finish(new Error(remoteError || 'Unexpected response ID'));
        return;
      }
      finish(
        message.error ? new Error(remoteError ?? 'Invalid bridge error') : null,
        message.result,
      );
    });
    socket.setTimeout(timeout, () =>
      finish(new Error('Bridge timed out. Outcome unknown; list tabs before retrying a mutation.')),
    );
    socket.on('connect', () => {
      const line = JSON.stringify({ id, method, params }) + '\n';
      if (Buffer.byteLength(line) > MAX_MESSAGE) finish(new Error('Request too large'));
      else socket.write(line);
    });
    socket.on('data', (chunk) => {
      try {
        decode(chunk);
      } catch (error) {
        finish(error);
      }
    });
    socket.on('error', (error) => finish(error));
    socket.on('close', () =>
      finish(
        new Error('Bridge disconnected. Outcome unknown; list tabs before retrying a mutation.'),
      ),
    );
  });
}
export async function sessions() {
  let files;
  try {
    files = await readdir(runtimeDirectory());
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }
  const results = await Promise.all(
    files
      .filter((name) => /^[a-f0-9]{16}\.sock$/.test(name))
      .map(async (name) => {
        try {
          const value = await request(name.slice(0, -5), '__ping', {}, 1000);
          if (!isSession(value)) throw new Error('Invalid bridge session');
          return value;
        } catch {
          return null;
        } // Ignore stale sockets left by a killed browser.
      }),
  );
  return results.filter((value) => value !== null);
}
export function callTool<K extends ToolName>(name: K, args?: ToolArgs[K]): Promise<ToolResults[K]>;
export function callTool(name: string, args?: unknown): Promise<unknown>;
export async function callTool(name: string, input: unknown = {}): Promise<unknown> {
  const args = validateCall(name, input);
  if (name === 'saul_sessions') return { sessions: await sessions() };
  let session = 'session' in args ? args.session : undefined;
  if (!session) {
    const active = await sessions();
    if (!active.length)
      throw new Error(
        'No Saul browser connected. Install the native host, reload Saul and enable Codex tab access in its popup.',
      );
    if (active.length > 1)
      throw new Error(
        'Multiple browsers/profiles connected. Call saul_sessions and supply a session ID.',
      );
    session = active[0]!.session;
  }
  const params: Record<string, unknown> = { ...args };
  delete params.session;
  if (!['saul_tabs_list', 'saul_windows_label'].includes(name))
    return validateToolResult(name as ToolName, await request(session, name, params));
  const connected = await request(session, '__ping');
  if (!isSession(connected)) throw new Error('Invalid bridge session');
  let names = nativeNames.get(session);
  if (!names) {
    if (nativeNames.size >= 32) nativeNames.delete(nativeNames.keys().next().value!);
    names = createWindowNames({ browserPid: connected.browserPid });
    nativeNames.set(session, names);
  }
  const value = await withWindowNames((method, input) => request(session!, method, input), names)(
    name,
    params,
  );
  return validateToolResult(name as ToolName, value);
}
