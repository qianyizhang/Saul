#!/usr/bin/env node
import net from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { chmodSync, rmSync } from 'node:fs';
import {
  encodeNative,
  nativeDecoder,
  lineDecoder,
  runtimeDirectory,
  secureDirectory,
} from './transport.mjs';
import { validateCall, MAX_MESSAGE } from './protocol.mjs';

const origin = process.argv[2];
if (!/^chrome-extension:\/\/[a-p]{32}\/$/.test(origin ?? '')) {
  console.error('This host must be launched by Chrome native messaging.');
  process.exit(1);
}
process.umask(0o077);
const directory = runtimeDirectory();
secureDirectory(directory);
const session = randomBytes(8).toString('hex');
const socketPath = join(directory, `${session}.sock`);
if (Buffer.byteLength(socketPath) > 100)
  throw new Error('SAUL_RUNTIME_DIR is too long for a Unix socket');
const pending = new Map();
const sockets = new Set();
const connectedAt = new Date().toISOString();
const send = (socket, value) => {
  const line = JSON.stringify(value) + '\n';
  if (Buffer.byteLength(line) > MAX_MESSAGE) {
    socket.end(
      JSON.stringify({
        id: value.id,
        error: { message: 'Response too large; query one window at a time' },
      }) + '\n',
    );
  } else socket.end(line);
};
const server = net.createServer((socket) => {
  sockets.add(socket);
  let requestId;
  let received = false;
  socket.setTimeout(35000, () => socket.destroy());
  socket.on('error', () => {});
  socket.on('close', () => {
    sockets.delete(socket);
    if (requestId && pending.has(requestId)) {
      clearTimeout(pending.get(requestId).timer);
      pending.delete(requestId);
    }
  });
  const decode = lineDecoder((request) => {
    if (received) throw new Error('One request per connection');
    received = true;
    if (!request || typeof request.id !== 'string') throw new Error('Invalid request');
    if (request.method === '__ping') {
      send(socket, {
        id: request.id,
        result: { session, extensionId: origin.split('/')[2], pid: process.pid, connectedAt },
      });
      return;
    }
    validateCall(request.method, request.params);
    if (request.method === 'saul_sessions')
      throw new Error('Session discovery is a client operation');
    if (pending.size >= 32) throw new Error('Bridge busy; wait for outstanding requests');
    requestId = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(requestId);
      send(socket, {
        id: request.id,
        error: {
          message: 'Browser timed out. Outcome unknown; list tabs before retrying a mutation.',
        },
      });
    }, 30000);
    pending.set(requestId, { socket, clientId: request.id, timer });
    process.stdout.write(
      encodeNative({ id: requestId, method: request.method, params: request.params ?? {} }),
    );
  });
  socket.on('data', (chunk) => {
    try {
      decode(chunk);
    } catch (error) {
      send(socket, { error: { message: error.message } });
    }
  });
});
const decode = nativeDecoder((message) => {
  if (!message || typeof message.id !== 'string') return;
  const item = pending.get(message.id);
  if (!item) return;
  pending.delete(message.id);
  clearTimeout(item.timer);
  send(item.socket, { ...message, id: item.clientId });
});
let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const socket of sockets) socket.destroy();
  for (const item of pending.values()) clearTimeout(item.timer);
  server.close();
  rmSync(socketPath, { force: true });
  process.exit(code);
}
process.stdin.on('data', (chunk) => {
  try {
    decode(chunk);
  } catch (error) {
    console.error(error.message);
    shutdown(1);
  }
});
process.stdin.on('end', () => shutdown());
process.stdin.on('error', () => shutdown(1));
process.stdout.on('error', () => shutdown(1));
process.on('SIGTERM', () => shutdown());
process.on('SIGINT', () => shutdown());
server.on('error', (error) => {
  console.error(error.message);
  shutdown(1);
});
server.listen(socketPath, () => {
  chmodSync(socketPath, 0o600);
  process.stdout.write(encodeNative({ type: 'ready' }));
});
