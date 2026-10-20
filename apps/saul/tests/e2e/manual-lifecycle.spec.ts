import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { access, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../..', import.meta.url));

function waitForProfile(child: ChildProcess, output: { stdout: string; stderr: string }) {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(new Error(`Manual harness did not become ready.\n${output.stdout}${output.stderr}`)),
      20_000,
    );
    const ready = (chunk: Buffer) => {
      output.stdout += chunk.toString();
      const profile = output.stdout.match(/^Profile: (.+)$/m)?.[1];
      if (!profile) return;
      clearTimeout(timer);
      resolve(profile);
    };
    child.stdout?.on('data', ready);
    child.stderr?.on('data', (chunk: Buffer) => {
      output.stderr += chunk.toString();
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Manual harness exited before it became ready (${code ?? signal}).\n${output.stdout}${output.stderr}`,
        ),
      );
    });
  });
}

function waitForExit(child: ChildProcess) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

test('manual harness handles SIGINT and removes its disposable profile', async () => {
  test.setTimeout(30_000);
  const output = { stdout: '', stderr: '' };
  const child = spawn(process.execPath, ['tests/e2e/manual.ts', '--headless'], {
    cwd: repository,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let sandboxRoot: string | undefined;
  try {
    const profile = await waitForProfile(child, output);
    const candidateRoot = path.dirname(profile);
    expect(path.basename(candidateRoot)).toMatch(/^saul-browser-/);
    sandboxRoot = candidateRoot;
    const exited = waitForExit(child);
    expect(child.kill('SIGINT')).toBe(true);
    await expect(exited).resolves.toEqual({ code: 0, signal: null });
    await expect(access(sandboxRoot)).rejects.toThrow();
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = waitForExit(child);
      child.kill('SIGTERM');
      await exited;
    }
    if (sandboxRoot) await rm(sandboxRoot, { recursive: true, force: true });
  }
});
