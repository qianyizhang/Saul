import { spawn, execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { availableParallelism, totalmem } from 'node:os';
import { fileURLToPath } from 'node:url';
import { artifactConfig } from '../tests/e2e/artifacts.ts';

if (!process.env.SAUL_TEST_RUN || process.env.SAUL_TEST_RUN === 'latest')
  throw new Error('Set a distinct SAUL_TEST_RUN for each measured run.');
const output = artifactConfig('e2e').outputDir;
if (!output) throw new Error('Missing browser artifact directory.');
const directory = dirname(output);
mkdirSync(directory, { recursive: true });

function processes() {
  return execFileSync('ps', ['-axo', 'pid=,ppid=,rss='], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((line) => {
      const [pid, parent, rss] = line.trim().split(/\s+/).map(Number);
      if (![pid, parent, rss].every((value) => value !== undefined && Number.isFinite(value)))
        throw new Error('Incomplete process resource sample.');
      return { pid: pid!, parent: parent!, rss: rss! };
    });
}
processes();
const args = ['exec', 'playwright', 'test', ...process.argv.slice(2)];
const log = openSync(join(directory, 'profile.log'), 'w');
const started = performance.now();
const child = spawn('/usr/bin/time', ['-p', 'pnpm', ...args], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let tail = '';
child.stdout.on('data', (data: Buffer) => writeSync(log, data));
child.stderr.on('data', (data: Buffer) => {
  writeSync(log, data);
  tail = (tail + data.toString()).slice(-8192);
});
let peakAggregateRssKiB = 0;
let samples = 0;
function sample() {
  const rows = processes();
  const descendants = new Set([child.pid]);
  for (let before = -1; before !== descendants.size;) {
    before = descendants.size;
    for (const row of rows) if (descendants.has(row.parent)) descendants.add(row.pid);
  }
  const rss = rows.reduce((sum, row) => sum + (descendants.has(row.pid) ? row.rss : 0), 0);
  peakAggregateRssKiB = Math.max(peakAggregateRssKiB, rss);
  samples++;
}
function interrupt(signal: NodeJS.Signals) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}
let samplingError: unknown;
const sampler = setInterval(() => {
  try {
    sample();
  } catch (error) {
    samplingError = error;
    interrupt('SIGTERM');
  }
}, 1000);
const onInterrupt = () => interrupt('SIGINT');
const onTerminate = () => interrupt('SIGTERM');
process.on('SIGINT', onInterrupt);
process.on('SIGTERM', onTerminate);
try {
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (samplingError) throw samplingError;
  const cpu = (name: string) => {
    const value = tail.match(new RegExp(`^${name}\\s+([\\d.]+)\\s*$`, 'm'))?.[1];
    if (!value) throw new Error(`Missing ${name} CPU timing.`);
    return Number(value);
  };
  const report = {
    command: ['pnpm', ...args],
    platform: process.platform,
    availableCpus: availableParallelism(),
    systemMemoryBytes: totalmem(),
    wallSeconds: (performance.now() - started) / 1000,
    userCpuSeconds: cpu('user'),
    systemCpuSeconds: cpu('sys'),
    peakAggregateRssKiB,
    memorySampleIntervalMs: 1000,
    memorySamples: samples,
    exitCode: code,
  };
  writeFileSync(join(directory, 'resources.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  process.exitCode = code ?? 1;
} finally {
  clearInterval(sampler);
  process.off('SIGINT', onInterrupt);
  process.off('SIGTERM', onTerminate);
  closeSync(log);
}
