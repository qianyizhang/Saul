import {
  appendFileSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eventSchema, type Event } from './diagnostic-events.mts';

const UUID = /^[a-f0-9-]{36}$/;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const CAPTURE_FILE = /^capture-[a-f0-9-]{36}\.json$/;
export function pruneSessions(root: string, appId: string, now = Date.now()) {
  const inactive: { path: string; started: number }[] = [];
  for (const name of readdirSync(root)) {
    if (!UUID.test(name)) continue;
    const path = join(root, name);
    if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory()) continue;
    // Only our flat known files are eligible; never recurse into an unknown tree.
    const children = readdirSync(path);
    if (
      !children.includes('session.json') ||
      children.some(
        (child) =>
          (!['session.json', 'app.jsonl', 'app.jsonl.1', 'server.jsonl', 'server.jsonl.1'].includes(
            child,
          ) &&
            !CAPTURE_FILE.test(child)) ||
          !lstatSync(join(path, child)).isFile() ||
          lstatSync(join(path, child)).isSymbolicLink(),
      )
    )
      continue;
    try {
      const info = JSON.parse(readFileSync(join(path, 'session.json'), 'utf8')) as {
        owner?: string;
        pid?: number;
        started?: number;
      };
      if (info.owner !== appId || !Number.isInteger(info.pid) || !Number.isFinite(info.started))
        continue;
      try {
        process.kill(info.pid!, 0);
        continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue;
      }
      inactive.push({ path, started: info.started! });
    } catch {
      /* Unrecognized evidence is not ours to remove. */
    }
  }
  inactive.sort((a, b) => b.started - a.started);
  inactive.forEach((entry, index) => {
    if (index >= 8 || now - entry.started > 7 * 86400_000) rmSync(entry.path, { recursive: true });
  });
}
export class LogStore {
  readonly instance = randomUUID();
  readonly directory: string;
  error: string | undefined;
  readonly events: Event[] = [];
  constructor(
    appId: string,
    root = process.env.MCP_APP_LOG_ROOT ??
      join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local/state'), 'mcp-apps'),
  ) {
    const appRoot = resolve(root, appId);
    this.directory = join(appRoot, this.instance);
    try {
      mkdirSync(appRoot, { recursive: true, mode: 0o700 });
      if (lstatSync(appRoot).isSymbolicLink())
        throw new Error('Log app root must not be a symlink');
      pruneSessions(appRoot, appId);
      mkdirSync(this.directory, { mode: 0o700 });
      writeFileSync(
        join(this.directory, 'session.json'),
        JSON.stringify({
          owner: appId,
          pid: process.pid,
          started: Date.now(),
        }),
        { mode: 0o600, flag: 'wx' },
      );
    } catch (error) {
      this.error = String(error);
    }
  }
  append(input: Event) {
    const event = eventSchema.parse(input);
    if (this.events.some((item) => item.id === event.id)) return;
    this.events.push(event);
    if (this.events.length > 500) this.events.shift();
    if (this.error) return;
    try {
      const file = join(this.directory, `${event.source}.jsonl`);
      const line =
        JSON.stringify({
          ...event,
          payload: {
            ...event.payload,
            text: '[payload is live only; not persisted]',
            omitted: true,
          },
        }) + '\n';
      if (existsSync(file) && statSync(file).size + Buffer.byteLength(line) > MAX_FILE_BYTES) {
        renameSync(file, `${file}.1`);
      }
      appendFileSync(file, line, { mode: 0o600 });
      chmodSync(file, 0o600);
    } catch (error) {
      this.error = String(error);
    }
  }
  capture(interaction: string) {
    const events = this.events.filter((event) => event.interaction === interaction);
    if (!events.length) throw new Error('Interaction unavailable or expired');
    if (this.error) throw new Error('Diagnostic storage unavailable');
    if (readdirSync(this.directory).filter((name) => CAPTURE_FILE.test(name)).length >= 8)
      throw new Error('Capture limit reached: 8 per server session');
    const savedAt = new Date().toISOString();
    const body = JSON.stringify({ instance: this.instance, interaction, savedAt, events }, null, 2);
    if (Buffer.byteLength(body) > MAX_FILE_BYTES)
      throw new Error('Interaction exceeds the 2 MiB capture limit; no capture saved');
    const path = join(this.directory, `capture-${randomUUID()}.json`);
    writeFileSync(path, body, { mode: 0o600, flag: 'wx' });
    return { path, savedAt, eventCount: events.length };
  }
  status() {
    return {
      directory: this.directory,
      health: this.error ? 'memory-only' : 'recording',
      error: this.error ?? null,
      payloads:
        'Metadata on disk; credential-masked payloads in bounded memory. Closing/restarting can lose payloads. Save diagnostic capture persists one interaction explicitly.',
      captures: 'Up to 8 per session, 2 MiB each; same session retention; no automatic capture',
      retention:
        '2 MiB/source + one rotated file; startup keeps 8 inactive sessions for at most 7 days; active sessions excluded',
      coverage: 'SDK/application boundaries only; host internals and assistant replies unobserved',
    };
  }
}
