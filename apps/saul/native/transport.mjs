import { endianness, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdirSync, lstatSync, chmodSync } from 'node:fs';
import { MAX_MESSAGE } from './protocol.mjs';

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function runtimeDirectory() {
  return resolve(process.env.SAUL_RUNTIME_DIR || join(homedir(), '.saul', 'run'));
}
export function secureDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid())
    throw new Error('Runtime directory must be owned by the current user and not be a symlink');
  chmodSync(directory, 0o700);
}
export function encodeNative(value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (!body.length || body.length > MAX_MESSAGE) throw new Error('Native message exceeds 1 MiB');
  const header = Buffer.alloc(4);
  header[endianness() === 'LE' ? 'writeUInt32LE' : 'writeUInt32BE'](body.length);
  return Buffer.concat([header, body]);
}
export function nativeDecoder(onMessage) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer[endianness() === 'LE' ? 'readUInt32LE' : 'readUInt32BE'](0);
      if (!length || length > MAX_MESSAGE) throw new Error('Invalid native message length');
      if (buffer.length < length + 4) return;
      const body = buffer.subarray(4, length + 4);
      buffer = buffer.subarray(length + 4);
      onMessage(JSON.parse(body.toString('utf8')));
    }
  };
}
export function lineDecoder(onMessage) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    let end;
    while ((end = buffer.indexOf(10)) !== -1) {
      if (end > MAX_MESSAGE) throw new Error('Message exceeds 1 MiB');
      const line = buffer.subarray(0, end).toString('utf8');
      buffer = buffer.subarray(end + 1);
      if (line.trim()) onMessage(JSON.parse(line));
    }
    if (buffer.length > MAX_MESSAGE) throw new Error('Message exceeds 1 MiB');
  };
}
