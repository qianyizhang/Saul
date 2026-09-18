import net from 'node:net';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runtimeDirectory, lineDecoder } from './transport.mjs';
import { validateCall, MAX_MESSAGE } from './protocol.mjs';

export function request(session, method, params = {}, timeout = 35000) {
  if (!/^[a-f0-9]{16}$/.test(session)) throw new Error('Invalid session ID');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(join(runtimeDirectory(), `${session}.sock`));
    const id = randomUUID();
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const decode = lineDecoder((message) => {
      if (message.id !== id) {
        finish(new Error(message.error?.message || 'Unexpected response ID'));
        return;
      }
      finish(message.error ? new Error(message.error.message) : null, message.result);
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
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const results = await Promise.all(
    files
      .filter((name) => /^[a-f0-9]{16}\.sock$/.test(name))
      .map(async (name) => {
        try {
          return await request(name.slice(0, -5), '__ping', {}, 1000);
        } catch {
          return null;
        } // Ignore stale sockets left by a killed browser.
      }),
  );
  return results.filter(Boolean);
}
export async function callTool(name, args = {}) {
  validateCall(name, args);
  if (name === 'saul_sessions') return { sessions: await sessions() };
  let session = args.session;
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
    session = active[0].session;
  }
  const { session: ignored, ...params } = args;
  return request(session, name, params);
}
